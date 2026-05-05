// ===== CONFIG =====
const GEMINI_API_KEY = "AIzaSyB5rVxiyWUC65w-K_1Jaxfi3XOoij8qgbw";
const GEMINI_MODEL = "gemini-1.5-flash";

// ===== STATE =====
let cameraStream = null;
let history = [];
let profiles = [];
let users = [];
let conversations = {}; // key: sorted "userA|userB", value: [{from,to,text,ts}]
let currentUser = null;
let activeChatUser = null;
let highContrast = false;

// PM / Matrix
let pmMatrix = [];          // full matrix
let pmMatrixLoaded = false;
let matrixSelectedIndex = null;

// ===== CORE UI =====
function openLayer(id) {
  if (!canAccessLayer(id)) {
    alert("You do not have permission to access this area.");
    return;
  }

  document.querySelectorAll(".layer").forEach(l => l.classList.remove("active"));
  document.getElementById(id).classList.add("active");

  if (id === "lensLayer") initCamera();
  if (id === "historyLayer") renderHistory();
  if (id === "profilesLayer") renderProfiles();
  if (id === "maintenanceLayer") renderMaintenance();
  if (id === "pmLayer") renderPMList();
  if (id === "messagingLayer") renderUserList();
  if (id === "userManagerLayer") renderUserManager();
  if (id === "matrixLogLayer") renderMatrixLog();
}

function login() {
  const user = document.getElementById("loginUsername").value.trim();
  const pass = document.getElementById("loginPasscode").value.trim();
  const err = document.getElementById("loginError");

  loadState();

  if (!users.length) {
    users = [
      {
        username: "brett",
        passcode: "1214",
        role: "admin",
        permissions: {
          lens: true,
          tools: true,
          maintenance: true,
          messaging: true,
          training: true,
          settings: true
        },
        disabled: false
      }
    ];
  }

  const found = users.find(
    u => u.username === user && u.passcode === pass && !u.disabled
  );

  if (found) {
    currentUser = found;
    err.classList.add("hidden");
    persistState();
    openLayer("menuLayer");
  } else {
    err.textContent = "Invalid username or passcode.";
    err.classList.remove("hidden");
  }
}

function canAccessLayer(layerId) {
  if (!currentUser) return layerId === "loginLayer";

  const p = currentUser.permissions || {};
  switch (layerId) {
    case "lensLayer": return !!p.lens;
    case "toolsLayer":
    case "diagnosticsLayer":
    case "profilesLayer":
    case "historyLayer":
    case "calibrationLayer":
    case "galleryLayer":
    case "pmLayer":
      return !!p.tools;
    case "maintenanceLayer": return !!p.maintenance;
    case "messagingLayer": return !!p.messaging;
    case "trainingLayer": return !!p.training;
    case "settingsLayer":
    case "userManagerLayer":
    case "matrixLogLayer":
      return !!p.settings;
    default:
      return true;
  }
}

// ===== CAMERA / LENS =====
function initCamera() {
  const video = document.getElementById("cameraFeed");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.error("Camera not supported");
    return;
  }

  if (cameraStream) {
    video.srcObject = cameraStream;
    return;
  }

  navigator.mediaDevices.getUserMedia({ video: true })
    .then(stream => {
      cameraStream = stream;
      video.srcObject = stream;
    })
    .catch(err => console.error("Camera error:", err));
}

function captureAndAnalyze() {
  const video = document.getElementById("cameraFeed");
  if (!video || !video.videoWidth) {
    setLensAnalysis("Camera not ready.");
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg");
  const base64Data = dataUrl.split(",")[1];

  setLensAnalysis("Analyzing view with Gemini…");
  callGeminiVision(base64Data, "You are an industrial technician assistant. Describe visible components, likely failure modes, and what to inspect next.")
    .then(text => {
      setLensAnalysis(text);
      pushHistoryEntry("Lens Analysis", text);
    })
    .catch(err => {
      console.error(err);
      setLensAnalysis("Error analyzing image.");
    });
}

function setLensAnalysis(text) {
  document.getElementById("lensAnalysis").textContent = text;
}

// ===== GEMINI CORE CALLS =====
async function callGeminiText(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt }
        ]
      }
    ]
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error("Gemini text error: " + res.status);
  }

  const data = await res.json();
  const candidates = data.candidates || [];
  const first = candidates[0];
  const part = first && first.content && first.content.parts && first.content.parts[0];
  return part && part.text ? part.text : "(No response)";
}

async function callGeminiVision(base64Image, instruction) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const body = {
    contents: [
      {
        parts: [
          { text: instruction },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image
            }
          }
        ]
      }
    ]
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error("Gemini vision error: " + res.status);
  }

  const data = await res.json();
  const candidates = data.candidates || [];
  const first = candidates[0];
  const part = first && first.content && first.content.parts && first.content.parts[0];
  return part && part.text ? part.text : "(No response)";
}

// ===== DIAGNOSTICS =====
function runDiagnostics() {
  const input = document.getElementById("diagnosticsInput").value.trim();
  const out = document.getElementById("diagnosticsOutput");

  if (!input) {
    out.textContent = "Enter symptoms first.";
    return;
  }

  out.textContent = "Running diagnostics with Gemini…";

  const prompt = `
You are an OEM-level industrial waterjet / high-pressure system technician.
User symptoms:
${input}

Return:
- Likely root causes
- Checks to perform
- Safety warnings
- Next steps
`;

  callGeminiText(prompt)
    .then(text => {
      out.textContent = text;
      pushHistoryEntry("Diagnostics", `Input: ${input}\n\nOutput:\n${text}`);
    })
    .catch(err => {
      console.error(err);
      out.textContent = "Error running diagnostics.";
    });
}

// ===== PROFILES =====
function saveProfile() {
  const name = document.getElementById("profileName").value.trim();
  const loc = document.getElementById("profileLocation").value.trim();
  const notes = document.getElementById("profileNotes").value.trim();

  if (!name) return;

  const existing = profiles.find(p => p.name === name);
  if (existing) {
    existing.location = loc;
    existing.notes = notes;
  } else {
    profiles.push({ name, location: loc, notes });
  }

  persistState();
  renderProfiles();
}

function renderProfiles() {
  const box = document.getElementById("profilesList");
  box.innerHTML = "";
  if (!profiles.length) {
    box.textContent = "No machine profiles yet.";
    return;
  }

  profiles.forEach(p => {
    const div = document.createElement("div");
    div.style.marginBottom = "8px";
    div.innerHTML = `<strong>${p.name}</strong><br>${p.location || ""}<br>${p.notes || ""}`;
    box.appendChild(div);
  });
}

function clearProfiles() {
  profiles = [];
  persistState();
  renderProfiles();
}

// ===== HISTORY =====
function pushHistoryEntry(type, details) {
  const entry = {
    type,
    details,
    ts: new Date().toISOString()
  };
  history.unshift(entry);
  persistState();
}

function renderHistory() {
  const box = document.getElementById("historyList");
  box.innerHTML = "";
  if (!history.length) {
    box.textContent = "No history yet.";
    return;
  }

  history.forEach(h => {
    const div = document.createElement("div");
    div.style.marginBottom = "10px";
    div.innerHTML = `<strong>${h.type}</strong> — ${h.ts}<br>${h.details.replace(/\n/g, "<br>")}`;
    box.appendChild(div);
  });
}

function clearHistory() {
  history = [];
  persistState();
  renderHistory();
}

// ===== MAINTENANCE / PM LIST (STATIC MAINT + MATRIX-DRIVEN PM) =====
function renderMaintenance() {
  const box = document.getElementById("maintenanceList");
  box.innerHTML = `
- Check pump oil level<br>
- Inspect high-pressure lines<br>
- Verify encoder feedback<br>
- Inspect nozzle wear<br>
- Review last 10 alarms
`;
}

// PM list from matrix
function renderPMList() {
  const box = document.getElementById("pmList");
  if (!pmMatrixLoaded) {
    box.textContent = "Loading PM matrix…";
    return;
  }

  const systemFilter = document.getElementById("pmFilterSystem").value;
  const machineFilter = document.getElementById("pmFilterMachine").value;
  const freqFilter = document.getElementById("pmFilterFrequency").value;

  const filtered = pmMatrix.filter(e => {
    if (systemFilter && e.system !== systemFilter) return false;
    if (machineFilter && e.machine !== machineFilter) return false;
    if (freqFilter && (e.frequency || "").toLowerCase() !== freqFilter.toLowerCase()) return false;
    return true;
  });

  if (!filtered.length) {
    box.textContent = "No PM tasks defined yet. PM fields are blank until you fill them in.";
    return;
  }

  const lines = filtered.map(e => {
    const freq = e.frequency || "(no frequency set)";
    const task = e.pmTask || "(no PM task set)";
    return `<strong>${e.system} — ${e.machine || "N/A"} — ${e.subAssembly} — ${e.component}</strong><br>${freq}: ${task}`;
  });

  box.innerHTML = lines.join("<br><br>");
}

// ===== TRAINING =====
const trainingData = {
  grasselli: {
    title: "Grasselli Training",
    modules: [
      "Blade Alignment",
      "Safety Procedures",
      "Daily Operation",
      "Troubleshooting",
      "Advanced Grasselli Course"
    ]
  },
  cut: {
    title: "MegaJet Cut Screen Training",
    modules: [
      "Cut Screen Overview",
      "Pressure Indicators",
      "Flow Indicators",
      "Alarm Codes",
      "Advanced Cut Screen Course"
    ]
  },
  servo: {
    title: "MegaJet Servoscope Training",
    modules: [
      "Servo Overview",
      "Encoder Feedback",
      "Motor Load Indicators",
      "Alarm Interpretation",
      "Advanced Servoscope Course"
    ]
  }
};

let currentTrainingCategory = null;

function showTrainingCategory(key) {
  currentTrainingCategory = key;
  const cat = trainingData[key];
  const modBox = document.getElementById("trainingModules");
  const contentBox = document.getElementById("trainingContent");
  modBox.innerHTML = "";
  contentBox.innerHTML = "";

  if (!cat) return;

  cat.modules.forEach(m => {
    const btn = document.createElement("button");
    btn.className = "menu-button";
    btn.textContent = m;
    btn.onclick = () => showTrainingContent(cat.title, m);
    modBox.appendChild(btn);
  });
}

function showTrainingContent(categoryTitle, moduleName) {
  const contentBox = document.getElementById("trainingContent");
  contentBox.innerHTML = `<strong>${categoryTitle} — ${moduleName}</strong><br><br>Training content placeholder for this module.`;
}

// ===== MESSAGING (USER-TO-USER) =====
function renderUserList() {
  const box = document.getElementById("userList");
  box.innerHTML = "";
  if (!users.length || !currentUser) {
    box.textContent = "No users.";
    return;
  }

  users
    .filter(u => u.username !== currentUser.username && !u.disabled)
    .forEach(u => {
      const div = document.createElement("div");
      div.style.marginBottom = "6px";
      div.innerHTML = `<button class="menu-button" onclick="openConversation('${u.username}')">${u.username}</button>`;
      box.appendChild(div);
    });

  if (!activeChatUser) {
    document.getElementById("activeChatUserLabel").textContent = "None";
    document.getElementById("chatLog").innerHTML = "";
  } else {
    document.getElementById("activeChatUserLabel").textContent = activeChatUser;
    renderConversation();
  }
}

function conversationKey(a, b) {
  return [a, b].sort().join("|");
}

function openConversation(username) {
  activeChatUser = username;
  document.getElementById("activeChatUserLabel").textContent = username;
  renderConversation();
}

function renderConversation() {
  const logEl = document.getElementById("chatLog");
  logEl.innerHTML = "";
  if (!currentUser || !activeChatUser) return;

  const key = conversationKey(currentUser.username, activeChatUser);
  const msgs = conversations[key] || [];

  msgs.forEach(m => {
    const div = document.createElement("div");
    div.className = m.from === currentUser.username ? "chat-entry-user" : "chat-entry-other";
    div.textContent = `${m.from}: ${m.text}`;
    logEl.appendChild(div);
  });

  logEl.scrollTop = logEl.scrollHeight;
}

function sendUserMessage() {
  const inputEl = document.getElementById("chatInput");
  const text = inputEl.value.trim();
  if (!text || !currentUser || !activeChatUser) return;

  const key = conversationKey(currentUser.username, activeChatUser);
  if (!conversations[key]) conversations[key] = [];

  const msg = {
    from: currentUser.username,
    to: activeChatUser,
    text,
    ts: new Date().toISOString()
  };
  conversations[key].push(msg);
  inputEl.value = "";
  persistState();
  renderConversation();
  pushHistoryEntry("Chat", `From: ${msg.from} To: ${msg.to}\n${msg.text}`);
}

// ===== USER MANAGER (ADMIN ONLY) =====
function isAdmin() {
  return currentUser && currentUser.role === "admin";
}

function renderUserManager() {
  const box = document.getElementById("userManagerList");
  if (!isAdmin()) {
    box.textContent = "Admin only.";
    return;
  }

  box.innerHTML = "";
  users.forEach(u => {
    const div = document.createElement("div");
    div.style.marginBottom = "6px";
    div.innerHTML = `<strong>${u.username}</strong> — ${u.role} ${u.disabled ? "(disabled)" : ""}`;
    box.appendChild(div);
  });
}

function saveUserFromManager() {
  if (!isAdmin()) return;

  const uname = document.getElementById("umUsername").value.trim();
  const pass = document.getElementById("umPasscode").value.trim();
  const role = document.getElementById("umRole").value;

  if (!uname || !pass) {
    setUserManagerStatus("Username and passcode required.");
    return;
  }

  const perms = {
    lens: document.getElementById("permLens").checked,
    tools: document.getElementById("permTools").checked,
    maintenance: document.getElementById("permMaintenance").checked,
    messaging: document.getElementById("permMessaging").checked,
    training: document.getElementById("permTraining").checked,
    settings: document.getElementById("permSettings").checked
  };

  let existing = users.find(u => u.username === uname);
  if (existing) {
    existing.passcode = pass;
    existing.role = role;
    existing.permissions = perms;
    existing.disabled = false;
    setUserManagerStatus("User updated.");
  } else {
    users.push({
      username: uname,
      passcode: pass,
      role,
      permissions: perms,
      disabled: false
    });
    setUserManagerStatus("User added.");
  }

  persistState();
  renderUserManager();
}

function deleteUserFromManager() {
  if (!isAdmin()) return;

  const uname = document.getElementById("umUsername").value.trim();
  if (!uname) {
    setUserManagerStatus("Enter username to delete.");
    return;
  }

  if (uname === "brett") {
    setUserManagerStatus("Cannot delete master admin.");
    return;
  }

  users = users.filter(u => u.username !== uname);
  persistState();
  renderUserManager();
  setUserManagerStatus("User deleted (if existed).");
}

function setUserManagerStatus(msg) {
  document.getElementById("userManagerStatus").textContent = msg;
}

// ===== MATRIX LOG (ADMIN ONLY) =====
function renderMatrixLog() {
  const body = document.getElementById("matrixLogBody");
  const status = document.getElementById("matrixLogStatus");
  const selectedIdLabel = document.getElementById("matrixSelectedId");

  if (!isAdmin()) {
    body.innerHTML = "";
    if (status) status.textContent = "Admin only.";
    if (selectedIdLabel) selectedIdLabel.textContent = "No entry selected";
    return;
  }

  if (!pmMatrixLoaded) {
    body.innerHTML = "";
    if (status) status.textContent = "Loading matrix…";
    return;
  }

  const systemFilter = document.getElementById("matrixFilterSystem").value;
  const machineFilter = document.getElementById("matrixFilterMachine").value;
  const search = document.getElementById("matrixFilterSearch").value.toLowerCase();

  body.innerHTML = "";

  pmMatrix.forEach((e, idx) => {
    if (systemFilter && e.system !== systemFilter) return;
    if (machineFilter && e.machine !== machineFilter) return;

    const haystack = [
      e.id,
      e.system,
      e.machine,
      e.lane,
      e.cutter,
      e.subAssembly,
      e.component
    ].join(" ").toLowerCase();

    if (search && !haystack.includes(search)) return;

    const tr = document.createElement("tr");
    tr.className = "matrix-row";
    tr.onclick = () => selectMatrixRow(idx);

    tr.innerHTML = `
      <td>${e.id}</td>
      <td>${e.system}</td>
      <td>${e.machine || ""}</td>
      <td>${e.lane || ""}</td>
      <td>${e.cutter || ""}</td>
      <td>${e.subAssembly || ""}</td>
      <td>${e.component || ""}</td>
      <td>${e.pmTask || ""}</td>
      <td>${e.frequency || ""}</td>
      <td>${e.severity || ""}</td>
      <td>${e.notes || ""}</td>
    `;
    body.appendChild(tr);
  });

  if (status) status.textContent = "";
}

function selectMatrixRow(index) {
  matrixSelectedIndex = index;
  const e = pmMatrix[index];
  document.getElementById("matrixSelectedId").textContent = e.id;
  document.getElementById("matrixEditPmTask").value = e.pmTask || "";
  document.getElementById("matrixEditFrequency").value = e.frequency || "";
  document.getElementById("matrixEditSeverity").value = e.severity || "";
  document.getElementById("matrixEditNotes").value = e.notes || "";
}

function saveMatrixEdit() {
  if (!isAdmin()) return;
  if (matrixSelectedIndex == null) {
    document.getElementById("matrixLogStatus").textContent = "No entry selected.";
    return;
  }

  const e = pmMatrix[matrixSelectedIndex];
  e.pmTask = document.getElementById("matrixEditPmTask").value.trim();
  e.frequency = document.getElementById("matrixEditFrequency").value.trim();
  e.severity = document.getElementById("matrixEditSeverity").value.trim();
  e.notes = document.getElementById("matrixEditNotes").value.trim();

  // Persist matrix edits locally
  try {
    localStorage.setItem("peco_matrix_overrides", JSON.stringify(pmMatrix));
  } catch (err) {
    console.error("Error saving matrix overrides:", err);
  }

  document.getElementById("matrixLogStatus").textContent = "Matrix entry updated.";
  renderMatrixLog();
  renderPMList();
}

// ===== SETTINGS =====
function toggleHighContrast() {
  highContrast = !highContrast;
  if (highContrast) {
    document.body.classList.add("high-contrast");
  } else {
    document.body.classList.remove("high-contrast");
  }
}

// ===== STATE PERSISTENCE =====
function persistState() {
  try {
    localStorage.setItem("peco_history", JSON.stringify(history));
    localStorage.setItem("peco_profiles", JSON.stringify(profiles));
    localStorage.setItem("peco_users", JSON.stringify(users));
    localStorage.setItem("peco_conversations", JSON.stringify(conversations));
  } catch (e) {
    console.error("Persist error:", e);
  }
}

function loadState() {
  try {
    const h = localStorage.getItem("peco_history");
    const p = localStorage.getItem("peco_profiles");
    const u = localStorage.getItem("peco_users");
    const c = localStorage.getItem("peco_conversations");
    history = h ? JSON.parse(h) : [];
    profiles = p ? JSON.parse(p) : [];
    users = u ? JSON.parse(u) : [];
    conversations = c ? JSON.parse(c) : {};
  } catch (e) {
    history = [];
    profiles = [];
    users = [];
    conversations = {};
  }
}

// ===== MATRIX LOAD =====
async function loadMatrix() {
  try {
    const res = await fetch("matrix.json");
    if (!res.ok) {
      console.error("Matrix load error:", res.status);
      pmMatrixLoaded = false;
      return;
    }
    const data = await res.json();

    // Apply local overrides if present
    const overridesRaw = localStorage.getItem("peco_matrix_overrides");
    if (overridesRaw) {
      const overrides = JSON.parse(overridesRaw);
      // Same length, same order assumption
      if (Array.isArray(overrides) && overrides.length === data.length) {
        pmMatrix = overrides;
      } else {
        pmMatrix = data;
      }
    } else {
      pmMatrix = data;
    }

    pmMatrixLoaded = true;
  } catch (err) {
    console.error("Matrix load error:", err);
    pmMatrixLoaded = false;
  }
}

// ===== INIT =====
window.addEventListener("load", () => {
  try {
    loadState();
  } catch (e) {
    console.error(e);
  }
  loadMatrix().then(() => {
    // PM list / matrix log will render when layers are opened
  });
});
