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

// ===== MAINTENANCE / PM LIST =====
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

function renderPMList() {
  const box = document.getElementById("pmList");
  box.innerHTML = `
<strong>Daily PM</strong><br>
- Visual leak check<br>
- Pressure gauge check<br><br>
<strong>Weekly PM</strong><br>
- Filter inspection<br>
- Hose inspection<br><br>
<strong>Monthly PM</strong><br>
- Pump oil change check<br>
- Encoder alignment check<br><br>
<strong>Annual PM</strong><br>
- Full system teardown and inspection
`;
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
  if (!isAdmin()) {
    document.getElementById("userManagerList").textContent = "Admin only.";
    return;
  }

  const box = document.getElementById("userManagerList");
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

// ===== INIT =====
window.addEventListener("load", () => {
  try {
    loadState();
  } catch (e) {
    console.error(e);
  }
});
