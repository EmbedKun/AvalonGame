// Turtle Soup - Participate mode JavaScript

window.addEventListener("beforeunload", () => {
  const keysToKeep = ["gameConfig", "selectedPortraits", "gameLanguage", "my_player_id"];
  Object.keys(sessionStorage).forEach((key) => {
    if (!keysToKeep.includes(key)) sessionStorage.removeItem(key);
  });
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted) window.location.reload();
});

// 1. IDENTITY
const myPlayerIdRaw = sessionStorage.getItem("my_player_id");
const myPlayerId = myPlayerIdRaw ? parseInt(myPlayerIdRaw, 10) : null;
const gameLanguage = sessionStorage.getItem("gameLanguage") || "zh";
document.body.classList.add(`lang-${gameLanguage}`);

let gameMetadata = null;

// 2. WEBSOCKET SETUP
const wsClient = new WebSocketClient(null, { uid: myPlayerId });

// 3. DOM ELEMENTS
const messagesContainer = document.getElementById("messages-container");
const roundDisplay = document.getElementById("round-display");
const statusDisplay = document.getElementById("status-display");
const userInputElement = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const userInputRequest = document.getElementById("user-input-request");
const inputPrompt = document.getElementById("input-prompt");
const tablePlayers = document.getElementById("table-players");
const inputContainer = document.querySelector(".input-container");

const modalOverlay = document.getElementById("modal-overlay");
const hostConfirmModal = document.getElementById("host-confirm-modal");
const gameEndedModal = document.getElementById("game-ended-modal");
const endTitle = document.getElementById("end-title");
const endReason = document.getElementById("end-reason");
const hostResetBtn = document.getElementById("host-reset-btn");
const confirmResetYes = document.getElementById("confirm-reset-yes");
const confirmResetNo = document.getElementById("confirm-reset-no");
const globalReturnLobbyBtn = document.getElementById("global-return-lobby-btn");

const gameSetup = document.getElementById("game-setup");
if (gameSetup && myPlayerId !== null) gameSetup.style.display = "none";

let messageCount = 0;
let numPlayers = 4;
let waitingForInput = false;

// 4. VISUAL HELPERS

function getPortraitSrc(playerId) {
  const validId = parseInt(playerId, 10);
  if (gameMetadata && gameMetadata.players) {
    const p = gameMetadata.players.find((x) => x.id === validId);
    if (p) {
      if (p.is_human) {
        if (p.portrait_id && p.portrait_id !== -1 && p.portrait_id !== "human") {
          return `/static/portraits/portrait_${p.portrait_id}.png`;
        }
        return `/static/portraits/portrait_human.png`;
      }
      if (p.portrait_id) return `/static/portraits/portrait_${p.portrait_id}.png`;
    }
  }
  if (myPlayerId !== null && validId === myPlayerId) return `/static/portraits/portrait_human.png`;
  return `/static/portraits/portrait_${(validId % 15) + 1}.png`;
}

function getModelName(playerId) {
  const validId = parseInt(playerId, 10);
  if (myPlayerId !== null && validId === myPlayerId) return "You";
  if (gameMetadata && gameMetadata.players) {
    const p = gameMetadata.players.find((x) => x.id === validId);
    if (p && p.name) return p.name;
  }
  return `Player ${validId}`;
}

let soupMasterId = 0; // will be updated from game_state

function getRoleLabel(playerId) {
  const validId = parseInt(playerId, 10);
  const isZh = gameLanguage === "zh" || gameLanguage === "cn";
  if (validId === soupMasterId) return isZh ? "soup master" : "Master";
  return isZh ? "guesser" : "Guesser";
}

function polarPositions(count, radiusX, radiusY) {
  return Array.from({ length: count }).map((_, i) => {
    const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
    return { x: radiusX * Math.cos(angle), y: radiusY * Math.sin(angle) };
  });
}

function setupTablePlayers(count) {
  numPlayers = count;
  tablePlayers.innerHTML = "";

  const rect = tablePlayers.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const isMobile = window.innerWidth <= 768;

  if (isMobile) {
    let row1Count, row2Count;
    if (count <= 5) { row1Count = count; row2Count = 0; }
    else { row1Count = Math.ceil(count / 2); row2Count = count - row1Count; }

    const itemWidth = 54;
    const gap = 18;
    const getStartX = (c) => (rect.width - (c * itemWidth + (c - 1) * gap)) / 2;
    const row1StartX = getStartX(row1Count);
    const row2StartX = getStartX(row2Count);
    const row1Y = row2Count === 0 ? rect.height * 0.5 : rect.height * 0.28;
    const row2Y = rect.height * 0.72;

    for (let i = 0; i < count; i++) {
      const seat = createSeatElement(i);
      let targetX, targetY;
      if (i < row1Count) { targetX = row1StartX + i * (itemWidth + gap); targetY = row1Y; }
      else { const rowIndex = i - row1Count; targetX = row2StartX + rowIndex * (itemWidth + gap); targetY = row2Y; }
      seat.style.left = `${targetX}px`;
      seat.style.top = `${targetY - 27}px`;
      seat.style.transform = `scale(1)`;
      seat.style.setProperty("--base-rotation", `0deg`);
      seat.style.width = `${itemWidth}px`;
      seat.style.height = `${itemWidth}px`;
      tablePlayers.appendChild(seat);
    }
  } else {
    let radiusX = Math.min(300, Math.max(160, rect.width * 0.45));
    let radiusY = Math.min(180, Math.max(100, rect.height * 0.4));
    const positions = polarPositions(count, radiusX, radiusY);

    for (let i = 0; i < count; i++) {
      const seat = createSeatElement(i);
      seat.style.left = `${cx + positions[i].x - 34}px`;
      seat.style.top = `${cy + positions[i].y - 34}px`;
      const baseRotation = (i % 2 ? 1 : -1) * 2;
      seat.style.setProperty("--base-rotation", `${baseRotation}deg`);
      seat.style.transform = `rotate(${baseRotation}deg)`;
      tablePlayers.appendChild(seat);
    }
  }
}

function createSeatElement(i) {
  const seat = document.createElement("div");
  seat.className = "seat";
  seat.dataset.playerId = String(i);
  const isMe = myPlayerId !== null && i === myPlayerId;
  if (isMe) seat.classList.add("is-me");

  const portraitSrc = getPortraitSrc(i);
  const modelName = getModelName(i);
  const roleLabel = getRoleLabel(i);

  seat.innerHTML = `
    <div class="seat-label">${roleLabel}</div>
    <span class="id-tag">${isMe ? "YOU" : "P" + i}</span>
    <img src="${portraitSrc}" alt="Player ${i}">
    <span class="name-tag">${modelName}</span>
    <div class="speech-bubble"></div>
  `;
  seat.classList.add("has-label");
  return seat;
}

function highlightSpeaker(playerId) {
  document.querySelectorAll(".seat").forEach((seat) => {
    const isSpeaking = seat.dataset.playerId === String(playerId);
    const bubble = seat.querySelector(".speech-bubble");
    if (isSpeaking) {
      seat.classList.add("speaking");
      if (bubble) { bubble.style.animation = "none"; bubble.offsetHeight; bubble.style.animation = "bubble-pop 2s ease-out forwards"; bubble.style.opacity = "1"; }
    } else {
      seat.classList.remove("speaking");
      if (bubble) bubble.style.opacity = "0";
    }
  });
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function addMessage(message) {
  messageCount++;
  if (messageCount === 1) messagesContainer.innerHTML = "";

  const messageDiv = document.createElement("div");
  messageDiv.className = "chat-message";

  let senderType = "system";
  let avatarHtml = '<div class="chat-avatar system"></div>';
  let senderName = message.sender || "System";
  let playerId = null;

  if (message.sender === "Moderator") {
    senderType = "moderator";
    avatarHtml = '<div class="chat-avatar system"></div>';
  } else if (message.sender && message.sender.startsWith("Player")) {
    const match = message.sender.match(/Player\s*(\d+)/);
    if (match) {
      playerId = parseInt(match[1], 10);
      senderType = playerId === myPlayerId ? "user" : "agent";
      avatarHtml = `<div class="chat-avatar"><img src="${getPortraitSrc(playerId)}" alt="${senderName}"></div>`;
      if (playerId === myPlayerId) messageDiv.classList.add("own");
      highlightSpeaker(playerId);
    }
  }

  messageDiv.innerHTML = `
    ${avatarHtml}
    <div class="chat-bubble">
      <div class="chat-header">
        <span class="chat-sender ${senderType}">${escapeHtml(senderName)}</span>
        <span class="chat-time">${formatTime(message.timestamp)}</span>
      </div>
      <div class="chat-content">${escapeHtml(message.content || "")}</div>
    </div>
  `;

  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// 5. GAME STATE

function updateGameState(state) {
  if (roundDisplay) roundDisplay.textContent = `Round: ${state.round_id ?? "-"}`;
  if (statusDisplay) statusDisplay.textContent = `Status: ${state.status ?? "Waiting"}`;

  // Update soup master ID from server
  if (state.soup_master_id !== undefined && state.soup_master_id !== null) {
    soupMasterId = state.soup_master_id;
  }

  if (state.num_players && (state.num_players !== numPlayers || tablePlayers.children.length === 0)) {
    setupTablePlayers(state.num_players);
  }
}

// 6. INPUT HANDLING

function showInputRequest(agentId, prompt) {
  if (myPlayerId === null) return;
  if (parseInt(agentId) !== myPlayerId) return;

  waitingForInput = true;
  inputPrompt.textContent = prompt;
  userInputRequest.style.display = "block";
  userInputElement.disabled = false;
  sendButton.disabled = false;
  userInputElement.focus();
  highlightSpeaker(myPlayerId);
}

function hideInputRequest() {
  waitingForInput = false;
  userInputRequest.style.display = "none";
  userInputElement.disabled = true;
  sendButton.disabled = true;
  userInputElement.value = "";
}

function sendUserInput() {
  const content = userInputElement.value.trim();
  if (!content) return;
  wsClient.sendUserInput(myPlayerId, content);
  hideInputRequest();
}

// 7. EVENT LISTENERS

sendButton.addEventListener("click", sendUserInput);
userInputElement.addEventListener("keypress", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendUserInput(); }
});

// Modal helpers
function showModal(modalType) {
  if (!modalOverlay) return;
  modalOverlay.style.display = "flex";
  if (modalType === "host_confirm") {
    if (hostConfirmModal) hostConfirmModal.style.display = "block";
    if (gameEndedModal) gameEndedModal.style.display = "none";
  } else if (modalType === "game_ended") {
    if (hostConfirmModal) hostConfirmModal.style.display = "none";
    if (gameEndedModal) gameEndedModal.style.display = "block";
  }
}

function hideModal() {
  if (modalOverlay) modalOverlay.style.display = "none";
  if (hostConfirmModal) hostConfirmModal.style.display = "none";
  if (gameEndedModal) gameEndedModal.style.display = "none";
}

// Host controls
if (myPlayerId === 0 && hostResetBtn) {
  hostResetBtn.style.display = "block";
  hostResetBtn.addEventListener("click", () => showModal("host_confirm"));
}

if (confirmResetYes) {
  confirmResetYes.addEventListener("click", () => {
    fetch("/api/stop-game", { method: "POST" }).then(res => res.json()).catch(err => console.error("API Error:", err));
  });
}
if (confirmResetNo) confirmResetNo.addEventListener("click", hideModal);
if (globalReturnLobbyBtn) globalReturnLobbyBtn.addEventListener("click", () => { window.location.href = "/"; });

// 8. WEBSOCKET HANDLERS

wsClient.onMessage("message", (message) => addMessage(message));

wsClient.onMessage("chat_history", (data) => {
  if (data && data.history && Array.isArray(data.history)) {
    data.history.forEach(msg => addMessage(msg));
    if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
});

wsClient.onMessage("GAME_FORCE_STOPPED", (data) => {
  if (endTitle) endTitle.textContent = "Room Dissolved";
  if (endReason) endReason.textContent = "The Host has terminated the session.";
  hideInputRequest();
  showModal("game_ended");
  if (hostResetBtn) hostResetBtn.style.display = "none";
});

wsClient.onMessage("game_state", (state) => {
  updateGameState(state);

  if (state.status === "running") {
    if (messagesContainer) messagesContainer.style.display = "flex";
    if (inputContainer) inputContainer.style.display = "flex";
  } else if (state.status === "stopped") {
    hideInputRequest();
  } else if (state.status === "finished") {
    hideInputRequest();
    if (endTitle) endTitle.textContent = "Game Finished";
    let reasonText = "The game has ended.";
    if (state.result && state.result.solved) reasonText = "Truth has been revealed!";
    else if (state.result) reasonText = "Time's up! Truth revealed.";
    if (endReason) endReason.textContent = reasonText;
    showModal("game_ended");
    if (hostResetBtn) hostResetBtn.style.display = "none";
  }
});

wsClient.onMessage("game_metadata", (data) => {
  if (data.metadata) {
    gameMetadata = data.metadata;
    setupTablePlayers(gameMetadata.num_players || 4);
  }
});

wsClient.onMessage("user_input_request", (request) => showInputRequest(request.agent_id, request.prompt));

wsClient.onMessage("error", (error) => {
  addMessage({ sender: "System", content: `Error: ${error.message || "Unknown error"}`, timestamp: new Date().toISOString() });
});

// 9. INITIALIZATION

wsClient.onConnect(() => { console.log(`Connected as Player ${myPlayerId}`); });
wsClient.onDisconnect(() => { hideInputRequest(); });

if (myPlayerId !== null) {
  wsClient.connect();
} else {
  console.warn("No MyPlayerID found.");
}

window.addEventListener("resize", () => { if (numPlayers) setupTablePlayers(numPlayers); });
