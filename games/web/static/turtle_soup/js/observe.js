// Turtle Soup - Observe mode JavaScript

window.addEventListener('beforeunload', () => {
    const keysToKeep = ['gameLanguage'];
    Object.keys(sessionStorage).forEach(key => {
        if (!keysToKeep.includes(key)) sessionStorage.removeItem(key);
    });
});

window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload();
});

const wsClient = new WebSocketClient();
const messagesContainer = document.getElementById('messages-container');
const roundDisplay = document.getElementById('round-display');
const statusDisplay = document.getElementById('status-display');
const gameSetup = document.getElementById('game-setup');
const startGameBtn = document.getElementById('start-game-btn');
const tablePlayers = document.getElementById('table-players');

let messageCount = 0;
let gameStarted = false;
let numPlayers = 4;
let playerMetadata = {};

const gameLanguage = sessionStorage.getItem('gameLanguage') || 'zh';
document.body.classList.add(`lang-${gameLanguage}`);

let selectedPortraits = [];
try {
    const stored = sessionStorage.getItem('selectedPortraits');
    if (stored) selectedPortraits = JSON.parse(stored);
} catch (e) {}

function getPortraitSrc(playerId) {
    const pid = parseInt(playerId, 10);
    if (playerMetadata[pid]) {
        const meta = playerMetadata[pid];
        if (meta.is_human) return `/static/portraits/portrait_human.png`;
        if (meta.portrait_id) return `/static/portraits/portrait_${meta.portrait_id}.png`;
    }
    if (selectedPortraits && pid < selectedPortraits.length) {
        const pId = selectedPortraits[pid];
        if (pId === -1) return `/static/portraits/portrait_human.png`;
        return `/static/portraits/portrait_${pId}.png`;
    }
    return `/static/portraits/portrait_${(pid % 15) + 1}.png`;
}

function getModelName(playerId) {
    const pid = parseInt(playerId, 10);
    if (playerMetadata[pid]) return playerMetadata[pid].name || `Player ${pid}`;
    return `Player ${pid}`;
}

let soupMasterId = 0;

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
    tablePlayers.innerHTML = '';
    const rect = tablePlayers.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const radiusX = Math.min(300, Math.max(160, rect.width * 0.45));
    const radiusY = Math.min(180, Math.max(100, rect.height * 0.40));
    const positions = polarPositions(count, radiusX, radiusY);

    for (let i = 0; i < count; i++) {
        const seat = document.createElement('div');
        seat.className = 'seat has-label';
        seat.dataset.playerId = String(i);
        seat.innerHTML = `
            <div class="seat-label">${getRoleLabel(i)}</div>
            <span class="id-tag">P${i}</span>
            <img src="${getPortraitSrc(i)}" alt="Player ${i}">
            <span class="name-tag">${getModelName(i)}</span>
            <div class="speech-bubble"></div>
        `;
        seat.style.left = `${cx + positions[i].x - 34}px`;
        seat.style.top = `${cy + positions[i].y - 34}px`;
        const baseRotation = (i % 2 ? 1 : -1) * 2;
        seat.style.setProperty('--base-rotation', `${baseRotation}deg`);
        seat.style.transform = `rotate(var(--base-rotation, 0deg))`;
        tablePlayers.appendChild(seat);
    }
}

function highlightSpeaker(playerId) {
    document.querySelectorAll('.seat').forEach(seat => {
        seat.classList.toggle('speaking', seat.dataset.playerId === String(playerId));
    });
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function addMessage(message) {
    messageCount++;
    if (messageCount === 1) messagesContainer.innerHTML = '';
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';
    let senderType = 'system';
    let avatarHtml = '<div class="chat-avatar system"></div>';
    let senderName = message.sender || 'System';

    if (message.sender === 'Moderator') {
        senderType = 'moderator';
    } else if (message.sender && message.sender.startsWith('Player')) {
        senderType = 'agent';
        const match = message.sender.match(/Player\s*(\d+)/);
        if (match) {
            const playerId = parseInt(match[1], 10);
            avatarHtml = `<div class="chat-avatar"><img src="${getPortraitSrc(playerId)}" alt="${senderName}"></div>`;
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
            <div class="chat-content">${escapeHtml(message.content || '')}</div>
        </div>
    `;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateGameState(state) {
    if (roundDisplay) roundDisplay.textContent = `Round: ${state.round_id ?? '-'}`;
    if (statusDisplay) statusDisplay.textContent = `Status: ${state.status ?? 'Waiting'}`;
    if (state.soup_master_id !== undefined && state.soup_master_id !== null) {
        soupMasterId = state.soup_master_id;
    }
    if (state.num_players && (state.num_players !== numPlayers || tablePlayers.children.length === 0)) {
        setupTablePlayers(state.num_players);
    }
}

// WEBSOCKET HANDLERS

wsClient.onMessage('message', (message) => addMessage(message));

wsClient.onMessage('game_config', (config) => {
    if (config && config.players) {
        config.players.forEach(p => { playerMetadata[p.id] = p; });
        setupTablePlayers(config.players.length);
    }
});

wsClient.onMessage('game_state', (state) => {
    updateGameState(state);
    if (state.status === 'running' && !gameStarted) {
        gameSetup.style.display = 'none';
        messagesContainer.style.display = 'flex';
        gameStarted = true;
    }
    if (state.status === 'stopped' || state.status === 'waiting') {
        gameStarted = false;
        if (messagesContainer.children.length === 0) gameSetup.style.display = 'block';
    }
});

wsClient.onMessage('error', (error) => {
    addMessage({ sender: 'System', content: `Error: ${error.message || 'Unknown error'}`, timestamp: new Date().toISOString() });
});

if (startGameBtn) {
    startGameBtn.addEventListener('click', () => {
        gameSetup.style.display = 'none';
        messagesContainer.style.display = 'flex';
        gameStarted = true;
    });
}

wsClient.onConnect(() => { console.log('Connected to game server'); });
wsClient.onDisconnect(() => { console.log('Disconnected'); });

function initializeObserve() {
    setupTablePlayers(numPlayers);
    wsClient.connect();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeObserve);
} else {
    initializeObserve();
}

window.addEventListener('resize', () => setupTablePlayers(numPlayers));
