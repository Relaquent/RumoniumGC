(() => {
    "use strict";

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    const state = {
        page: "overview",
        socket: null,
        logs: [],
        chat: [],
        stats: null,
        settings: {},
        blacklist: [],
        permissions: [],
        commands: [],
        fkdr: [],
        activity: [],
        welcome: [],
        permMode: "allow",
        health: 0,
        errorCount: 0
    };

    const pageNames = {
        overview: "OVERVIEW", bot: "BOT CONTROL", chat: "LIVE CONSOLE",
        blacklist: "BLACKLIST", tracking: "TRACKING", permissions: "ACCESS CONTROL",
        ai: "AI CORE", data: "DATA VAULT", logs: "EVENT LOGS", system: "TELEMETRY"
    };

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
    }

    function toast(message, type = "info") {
        const el = document.createElement("div");
        el.className = `toast ${type}`;
        el.innerHTML = `<strong>${type === "success" ? "✓" : type === "error" ? "!" : type === "warning" ? "△" : "•"}</strong><span>${escapeHtml(message)}</span>`;
        $("#toast-root").appendChild(el);
        setTimeout(() => el.remove(), 3600);
    }

    async function api(url, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeout || 12000);
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: { "Content-Type": "application/json", ...(options.headers || {}) }
            });
            const text = await response.text();
            let data = {};
            try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
            if (!response.ok) {
                throw new Error(data.message || data.error || `HTTP ${response.status}`);
            }
            return data;
        } finally {
            clearTimeout(timer);
        }
    }

    function formatUptime(msOrSeconds) {
        let seconds = Number(msOrSeconds) || 0;
        if (seconds > 1e9) seconds /= 1000;
        const d = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return d ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
    }

    function formatNumber(value) {
        return Number(value || 0).toLocaleString();
    }

    function formatTime(value) {
        if (!value) return "--:--:--";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value).slice(0, 8);
        return date.toLocaleTimeString([], { hour12: false });
    }

    function setPage(page) {
        if (!pageNames[page]) return;
        state.page = page;
        $$(".page").forEach(p => p.classList.toggle("active", p.id === `page-${page}`));
        $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.page === page));
        $("#page-name").textContent = pageNames[page];
        window.scrollTo({ top: 0, behavior: "smooth" });

        if (page === "overview") refreshCore();
        if (page === "bot") loadSettings();
        if (page === "blacklist") loadBlacklist();
        if (page === "tracking") loadTracking();
        if (page === "permissions") loadPermissions();
        if (page === "ai") loadPrompt();
        if (page === "system") loadSystem();
    }

    $$(".nav-item").forEach(btn => btn.addEventListener("click", () => {
        setPage(btn.dataset.page);
        $("#sidebar").classList.remove("open");
    }));

    $$("[data-go]").forEach(btn => btn.addEventListener("click", () => setPage(btn.dataset.go)));

    $("#mobile-menu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
    $("#refresh-btn").addEventListener("click", () => refreshCore(true));

    function setBotStatus(status) {
        const online = status === "online";
        const connecting = status === "connecting";
        const label = online ? "ONLINE" : connecting ? "CONNECTING" : "OFFLINE";
        const color = online ? "var(--green)" : connecting ? "var(--yellow)" : "var(--red)";
        $("#sidebar-status").textContent = label;
        $("#sidebar-dot").className = `status-dot ${online ? "online" : connecting ? "connecting" : ""}`;
        $("#hero-status").textContent = label;
        $("#hero-status").style.color = color;
        $("#stat-status").textContent = label;
        $("#stat-status").style.color = color;
        $("#stat-status-sub").textContent = online ? "Client ready" : connecting ? "Negotiating connection" : "Awaiting connection";
        $("#status-pulse").className = `pulse ${online ? "online" : ""}`;
        $("#bot-state-title").textContent = label;
        $("#bot-state-title").style.color = color;
        $("#bot-state-copy").textContent = online ? "The Minecraft client is ready for guild operations." : connecting ? "The client is negotiating a new connection." : "The client is not connected to Hypixel.";
        $("#bot-ready").textContent = online ? "YES" : "NO";
        $("#quick-status").textContent = online ? "READY" : label;
        $("#svc-hypixel").classList.toggle("online", online);
        $("#svc-hypixel-text").textContent = online ? "Client ready" : label.toLowerCase();
    }

    function addLog(entry, prepend = true) {
        if (!entry) return;
        const normalized = {
            time: entry.time || new Date().toLocaleTimeString([], { hour12: false }),
            type: entry.type || "info",
            msg: entry.msg || entry.message || ""
        };
        if (prepend) state.logs.unshift(normalized);
        else state.logs.push(normalized);
        state.logs = state.logs.slice(0, 350);
        if (normalized.type === "error") state.errorCount++;
        $("#error-count").textContent = state.errorCount > 99 ? "99+" : state.errorCount;
        renderFeed();
        if (state.page === "logs") renderLogs();
    }

    function renderFeed() {
        const feed = $("#overview-feed");
        const items = state.logs.slice(0, 12);
        if (!items.length) {
            feed.innerHTML = `<div class="empty-state">Waiting for live events...</div>`;
            return;
        }
        feed.innerHTML = items.map(x => `
            <div class="event-item ${escapeHtml(x.type)}">
                <span class="event-time">${escapeHtml(x.time)}</span>
                <span class="event-type">${escapeHtml(String(x.type).toUpperCase())}</span>
                <span class="event-message">${escapeHtml(x.msg)}</span>
            </div>
        `).join("");
    }

    function renderLogs() {
        const filter = $("#log-filter").value;
        const logs = filter === "all" ? state.logs : state.logs.filter(x => x.type === filter);
        $("#logs-list").innerHTML = logs.length ? logs.map(x => `
            <div class="log-line ${escapeHtml(x.type)}">
                <time>${escapeHtml(x.time)}</time>
                <span class="log-type">${escapeHtml(String(x.type).toUpperCase())}</span>
                <span class="log-message">${escapeHtml(x.msg)}</span>
            </div>
        `).join("") : `<div class="empty-state">No events in this filter.</div>`;
    }

    $("#log-filter").addEventListener("change", renderLogs);
    $("#clear-local-logs").addEventListener("click", () => {
        state.logs = [];
        state.errorCount = 0;
        $("#error-count").textContent = "0";
        renderLogs(); renderFeed();
        toast("Local log view cleared", "info");
    });

    function renderChat() {
        const el = $("#chat-stream");
        el.innerHTML = state.chat.length ? state.chat.slice(-220).map(x =>
            `<div class="chat-line"><span class="time">[${escapeHtml(x.time)}]</span>${escapeHtml(x.message)}</div>`
        ).join("") : `<div class="empty-state">No Minecraft events received yet.</div>`;
        el.scrollTop = el.scrollHeight;
        $("#chat-count").textContent = `${state.chat.length} EVENTS`;
    }

    function connectSocket() {
        if (!window.io) {
            $("#socket-label").textContent = "NO SOCKET.IO";
            return;
        }
        state.socket = io({ transports: ["websocket", "polling"], reconnection: true, reconnectionAttempts: Infinity, timeout: 8000 });

        state.socket.on("connect", () => {
            $("#socket-dot").className = "online";
            $("#socket-label").textContent = "CONNECTED";
            $("#svc-socket").classList.add("online");
            $("#svc-socket-text").textContent = "Realtime channel";
        });
        state.socket.on("disconnect", () => {
            $("#socket-dot").className = "";
            $("#socket-label").textContent = "RECONNECTING";
            $("#svc-socket").classList.remove("online");
            $("#svc-socket-text").textContent = "Reconnecting...";
        });
        state.socket.on("connect_error", () => {
            $("#socket-dot").className = "";
            $("#socket-label").textContent = "LINK ERROR";
        });
        state.socket.on("bot-status", setBotStatus);
        state.socket.on("minecraft-chat", d => {
            state.chat.push({ time: d.time, message: d.message });
            state.chat = state.chat.slice(-220);
            renderChat();
        });
        state.socket.on("bot-log", d => addLog(d));
        state.socket.on("stats-update", s => {
            if (s) {
                $("#hero-uptime").textContent = `UPTIME ${s.uptime || "--"}`;
                $("#stat-commands").textContent = formatNumber(s.commands);
                $("#stat-messages").textContent = formatNumber(s.messages);
            }
        });
    }

    async function loadStats() {
        const data = await api("/api/stats");
        state.stats = data;
        $("#stat-commands").textContent = formatNumber(data.commandCount);
        $("#stat-messages").textContent = formatNumber(data.messageCount);
        $("#stat-queue").textContent = formatNumber(data.queueLength);
        $("#bot-reconnects").textContent = formatNumber(data.reconnectAttempts);
        $("#hero-uptime").textContent = `UPTIME ${formatUptime(data.uptimeMs)}`;
        $("#health-api").textContent = data.queueLength ? `${data.queueLength} WAITING` : "CLEAR";
        $("#health-cache").textContent = formatNumber(data.cacheSize);
        $("#health-urchin").textContent = data.urchinEnabled ? (data.urchinUrl && data.urchinUrl !== "Not connected" ? "CONNECTED" : "ENABLED") : "DISABLED";
        setBotStatus(data.botReady ? "online" : "offline");
        renderCommandChart(data.topCommands || []);
        renderUserRank(data.topUsers || []);
        return data;
    }

    function renderCommandChart(items) {
        const list = (items || []).slice(0, 8);
        if (!list.length) {
            $("#command-chart").innerHTML = `<div class="empty-state">No command telemetry yet.</div>`;
            return;
        }
        const max = Math.max(...list.map(x => Number(x.count) || 0), 1);
        $("#command-chart").innerHTML = list.map(x => `
            <div class="bar-row">
                <code>!${escapeHtml(x.command)}</code>
                <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, ((Number(x.count) || 0) / max) * 100)}%"></div></div>
                <b>${formatNumber(x.count)}</b>
            </div>
        `).join("");
    }

    function renderUserRank(items) {
        const list = (items || []).slice(0, 7);
        $("#user-rank").innerHTML = list.length ? list.map((x, i) => `
            <div class="rank-item"><span class="rank-num">${String(i + 1).padStart(2, "0")}</span><span class="rank-name">${escapeHtml(x.username)}</span><b class="rank-value">${formatNumber(x.count)}</b></div>
        `).join("") : `<div class="empty-state">No operator activity yet.</div>`;
    }

    function calculateHealth() {
        const s = state.stats;
        if (!s) return;
        let score = 100;
        if (!s.botReady) score -= 35;
        if (Number(s.queueLength) > 10) score -= 10;
        if (Number(s.queueLength) > 30) score -= 10;
        if (state.errorCount > 0) score -= Math.min(20, state.errorCount);
        score = Math.max(0, Math.min(100, score));
        state.health = score;
        $("#health-score").textContent = score;
        $("#health-score").parentElement.style.background = `radial-gradient(circle at center, #07111e 56%, transparent 57%), conic-gradient(${score > 70 ? "var(--blue)" : "var(--yellow)"} ${score * 3.6}deg, #1b2c45 0deg)`;
        $("#health-title").textContent = score >= 90 ? "Nominal operation" : score >= 70 ? "Minor degradation" : "Attention required";
        $("#health-copy").textContent = score >= 90 ? "Core telemetry is within expected operating range." : "Review recent events and connection telemetry.";
        $("#health-badge").textContent = score >= 90 ? "NOMINAL" : score >= 70 ? "DEGRADED" : "ATTENTION";
        $("#health-badge").style.color = score >= 90 ? "var(--green)" : "var(--yellow)";
        $("#health-bot").textContent = s.botReady ? "NOMINAL" : "OFFLINE";
        $("#health-bot").style.color = s.botReady ? "var(--green)" : "var(--red)";
    }

    async function loadSettings() {
        const data = await api("/api/settings");
        state.settings = data;
        $("#set-auto").checked = !!data.autoReconnect;
        $("#set-welcome").checked = !!data.welcomeMessages;
        $("#set-cooldown").value = data.commandCooldown ?? 45;
        $("#set-tokens").value = data.maxTokens ?? 100;
        $("#set-message-delay").value = data.performance?.messageDelay ?? 300;
        $("#set-reconnect-delay").value = data.performance?.autoReconnectDelay ?? 15000;
        await loadWelcome();
    }

    $("#save-settings").addEventListener("click", async () => {
        const payload = {
            autoReconnect: $("#set-auto").checked,
            welcomeMessages: $("#set-welcome").checked,
            commandCooldown: Number($("#set-cooldown").value) || 0,
            maxTokens: Number($("#set-tokens").value) || 100,
            performance: {
                ...(state.settings.performance || {}),
                messageDelay: Number($("#set-message-delay").value) || 0,
                autoReconnectDelay: Number($("#set-reconnect-delay").value) || 15000
            }
        };
        try {
            $("#settings-state").textContent = "SAVING";
            await api("/api/settings", { method: "POST", body: JSON.stringify(payload) });
            state.settings = { ...state.settings, ...payload };
            $("#settings-state").textContent = "SYNCED";
            toast("Runtime profile applied", "success");
        } catch (e) {
            $("#settings-state").textContent = "ERROR";
            toast(e.message, "error");
        }
    });

    async function loadWelcome() {
        const data = await api("/api/welcome-messages");
        state.welcome = Array.isArray(data.messages) ? data.messages : [];
        renderWelcome();
    }

    function renderWelcome() {
        $("#welcome-count").textContent = state.welcome.length;
        $("#welcome-list").innerHTML = state.welcome.length ? state.welcome.map((x, i) => `
            <div class="welcome-item"><b>${String(i + 1).padStart(2, "0")}</b><span>${escapeHtml(x)}</span><button data-welcome-remove="${i}">×</button></div>
        `).join("") : `<div class="empty-state">No welcome messages configured.</div>`;
        $$("[data-welcome-remove]").forEach(b => b.addEventListener("click", () => {
            state.welcome.splice(Number(b.dataset.welcomeRemove), 1);
            renderWelcome();
        }));
    }

    $("#welcome-add").addEventListener("click", () => {
        const value = $("#welcome-input").value.trim();
        if (!value) return;
        state.welcome.push(value);
        $("#welcome-input").value = "";
        renderWelcome();
    });
    $("#welcome-input").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("#welcome-add").click(); } });
    $("#welcome-save").addEventListener("click", async () => {
        try {
            await api("/api/welcome-messages", { method: "POST", body: JSON.stringify({ messages: state.welcome }) });
            toast("Welcome sequence saved", "success");
        } catch (e) { toast(e.message, "error"); }
    });

    async function botAction(endpoint, successMessage) {
        try {
            const data = await api(endpoint, { method: "POST" });
            toast(data.message || successMessage, data.success === false ? "warning" : "success");
            await loadStats();
        } catch (e) { toast(e.message, "error"); }
    }
    $("#bot-start").addEventListener("click", () => botAction("/api/bot/start", "Bot start requested"));
    $("#bot-reconnect").addEventListener("click", () => botAction("/api/bot/reconnect", "Reconnect requested"));
    $("#bot-stop").addEventListener("click", () => botAction("/api/bot/disconnect", "Bot disconnected"));

    $("#chat-form").addEventListener("submit", async e => {
        e.preventDefault();
        const input = $("#chat-input");
        const message = input.value.trim();
        if (!message) return;
        try {
            const data = await api("/chat", { method: "POST", body: JSON.stringify({ message }) });
            if (data.success) { input.value = ""; toast("Message sent to Minecraft", "success"); }
            else toast(data.message || "Bot not ready", "error");
        } catch (err) { toast(err.message, "error"); }
    });
    $$("[data-chat]").forEach(b => b.addEventListener("click", () => {
        $("#chat-input").value = b.dataset.chat;
        $("#chat-input").focus();
    }));

    async function loadBlacklist() {
        const data = await api("/api/blacklist");
        state.blacklist = Array.isArray(data.entries) ? data.entries : [];
        $("#blacklist-count").textContent = data.total ?? state.blacklist.length;
        $("#blacklist-total").textContent = `${data.total ?? state.blacklist.length} RECORDS`;
        renderBlacklist();
    }

    function renderBlacklist() {
        const query = $("#blacklist-search").value.trim().toLowerCase();
        const list = state.blacklist.filter(x => !query || `${x.username} ${x.reason} ${x.addedBy}`.toLowerCase().includes(query));
        $("#blacklist-list").innerHTML = list.length ? list.map(x => `
            <article class="record-card">
                <div class="record-top">
                    <img class="mc-head" src="https://mc-heads.net/avatar/${encodeURIComponent(x.username)}/64" alt="">
                    <div><strong>${escapeHtml(x.username)}</strong><small>ID ${escapeHtml(x.id || "unknown")}</small></div>
                </div>
                <div class="record-reason">${escapeHtml(x.reason)}</div>
                <div class="record-meta"><span>BY ${escapeHtml(x.addedBy || "unknown")}</span><span>${escapeHtml(x.addedOn ? new Date(x.addedOn).toLocaleDateString() : "--")}</span></div>
                <div class="record-actions"><button class="btn" data-edit-bl="${escapeHtml(x.username)}">EDIT</button><button class="btn danger" data-remove-bl="${escapeHtml(x.username)}">REMOVE</button></div>
            </article>
        `).join("") : `<div class="panel" style="grid-column:1/-1"><div class="empty-state">${query ? "No matching records." : "Blacklist is clear."}</div></div>`;

        $$("[data-edit-bl]").forEach(b => b.addEventListener("click", () => openBlacklistModal(b.dataset.editBl)));
        $$("[data-remove-bl]").forEach(b => b.addEventListener("click", () => removeBlacklist(b.dataset.removeBl)));
    }
    $("#blacklist-search").addEventListener("input", renderBlacklist);

    function openBlacklistModal(username = "") {
        const item = state.blacklist.find(x => x.username.toLowerCase() === username.toLowerCase());
        $("#blacklist-modal-title").textContent = item ? "Edit blacklist entry" : "Add blacklist entry";
        $("#blacklist-edit-user").value = item ? item.username : "";
        $("#blacklist-user").value = item ? item.username : "";
        $("#blacklist-user").disabled = !!item;
        $("#blacklist-reason").value = item?.reason || "";
        $("#blacklist-addedby").value = item?.addedBy || "Relaquent";
        $("#blacklist-modal").classList.add("open");
    }
    $("#blacklist-add-open").addEventListener("click", () => openBlacklistModal());
    $$("[data-close-modal]").forEach(b => b.addEventListener("click", () => $(`#${b.dataset.closeModal}`).classList.remove("open")));

    $("#blacklist-form").addEventListener("submit", async e => {
        e.preventDefault();
        const editing = $("#blacklist-edit-user").value.trim();
        const payload = {
            username: editing || $("#blacklist-user").value.trim(),
            reason: $("#blacklist-reason").value.trim(),
            addedBy: $("#blacklist-addedby").value.trim()
        };
        if (!payload.username || !payload.reason || !payload.addedBy) return toast("Complete all fields", "warning");
        try {
            await api(editing ? "/api/blacklist/update" : "/api/blacklist/add", { method: "POST", body: JSON.stringify(payload) });
            $("#blacklist-modal").classList.remove("open");
            await loadBlacklist();
            toast(editing ? "Blacklist record updated" : "Blacklist record added", "success");
        } catch (err) { toast(err.message, "error"); }
    });

    async function removeBlacklist(username) {
        if (!confirm(`Remove ${username} from the blacklist?`)) return;
        try {
            await api("/api/blacklist/remove", { method: "POST", body: JSON.stringify({ username }) });
            await loadBlacklist();
            toast(`${username} removed`, "success");
        } catch (e) { toast(e.message, "error"); }
    }

    async function loadTracking() {
        const [fkdr, activity] = await Promise.all([api("/api/fkdr-tracking"), api("/api/activity-tracking")]);
        state.fkdr = fkdr.tracking || [];
        state.activity = activity.tracking || [];
        $("#fkdr-total").textContent = fkdr.count ?? state.fkdr.length;
        $("#activity-total").textContent = activity.count ?? state.activity.length;
        $("#tracking-count").textContent = (state.fkdr.length + state.activity.length) || 0;

        $("#fkdr-list").innerHTML = state.fkdr.length ? `
            <div class="table-head"><span>PLAYER</span><span>FKDR</span><span>SNAPSHOTS</span><span></span></div>
            ${state.fkdr.map(x => {
                const current = x.progress?.current?.fkdr ?? x.snapshots?.at(-1)?.fkdr ?? "--";
                return `<div class="table-row"><strong>${escapeHtml(x.username)}</strong><b>${escapeHtml(current)}</b><span>${x.snapshots?.length || 0}</span><button data-stop-fkdr="${escapeHtml(x.username)}">STOP</button></div>`;
            }).join("")}
        ` : `<div class="empty-state">No FKDR tracking records.</div>`;

        $("#activity-list").innerHTML = state.activity.length ? `
            <div class="table-head"><span>PLAYER</span><span>STATUS</span><span>SCORE</span><span></span></div>
            ${state.activity.map(x => {
                const detection = x.detection;
                const score = detection?.score ?? detection?.activityScore ?? "--";
                return `<div class="table-row"><strong>${escapeHtml(x.username)}</strong><b>${escapeHtml(score)}</b><span>${escapeHtml(detection?.status || "TRACKED")}</span><button data-stop-activity="${escapeHtml(x.username)}">STOP</button></div>`;
            }).join("")}
        ` : `<div class="empty-state">No activity tracking records.</div>`;

        $$("[data-stop-fkdr]").forEach(b => b.addEventListener("click", () => stopTracking("fkdr", b.dataset.stopFkdr)));
        $$("[data-stop-activity]").forEach(b => b.addEventListener("click", () => stopTracking("activity", b.dataset.stopActivity)));
    }

    async function stopTracking(type, username) {
        if (!confirm(`Stop ${type} tracking for ${username}?`)) return;
        const endpoint = type === "fkdr" ? "/api/fkdr-tracking/remove" : "/api/activity-tracking/remove";
        try {
            await api(endpoint, { method: "POST", body: JSON.stringify({ username }) });
            await loadTracking();
            toast(`${type.toUpperCase()} tracking stopped`, "success");
        } catch (e) { toast(e.message, "error"); }
    }

    async function loadPermissions() {
        const data = await api("/api/permissions");
        state.permissions = data.permissions || [];
        state.commands = data.availableCommands || [];
        renderCommandPicker();
        renderPermissions();
    }

    function renderCommandPicker() {
        $("#command-picker").innerHTML = state.commands.map(cmd => `
            <label class="command-option"><input type="checkbox" value="${escapeHtml(cmd)}"><span>!${escapeHtml(cmd)}</span></label>
        `).join("");
    }

    function renderPermissions() {
        $("#permission-list").innerHTML = state.permissions.length ? state.permissions.map(p => {
            const allowed = Array.isArray(p.allowedCommands);
            const list = p.allowedCommands || p.bannedCommands || [];
            return `<div class="policy-card"><div class="policy-card-head"><strong>${escapeHtml(p.username)}</strong><span class="policy-mode">${allowed ? "WHITELIST" : "BLACKLIST"}</span></div><div class="policy-tags">${list.map(c => `<span>!${escapeHtml(c)}</span>`).join("")}</div></div>`;
        }).join("") : `<div class="empty-state">No custom access policies. Default policy is permissive.</div>`;
    }

    $$(".mode-tabs button").forEach(b => b.addEventListener("click", () => {
        state.permMode = b.dataset.permMode;
        $$(".mode-tabs button").forEach(x => x.classList.toggle("active", x === b));
        $$("#command-picker input").forEach(x => x.checked = false);
    }));

    $("#perm-save").addEventListener("click", async () => {
        const username = $("#perm-user").value.trim();
        const selected = $$("#command-picker input:checked").map(x => x.value);
        if (!username) return toast("Enter a username", "warning");
        if (!selected.length) return toast("Select at least one command", "warning");
        const payload = { username };
        if (state.permMode === "allow") payload.allowedCommands = selected;
        else payload.bannedCommands = selected;
        try {
            await api("/api/permissions/set", { method: "POST", body: JSON.stringify(payload) });
            $("#perm-user").value = "";
            $$("#command-picker input").forEach(x => x.checked = false);
            await loadPermissions();
            toast("Access policy saved", "success");
        } catch (e) { toast(e.message, "error"); }
    });

    $("#perm-reset").addEventListener("click", async () => {
        const username = $("#perm-user").value.trim();
        if (!username) return toast("Enter a username", "warning");
        if (!confirm(`Reset permissions for ${username}?`)) return;
        try {
            await api("/api/permissions/remove", { method: "POST", body: JSON.stringify({ username }) });
            $("#perm-user").value = "";
            await loadPermissions();
            toast("Access policy reset", "success");
        } catch (e) { toast(e.message, "error"); }
    });

    async function loadPrompt() {
        const data = await api("/api/gpt-prompt");
        $("#ai-prompt").value = data.prompt || "";
        updatePromptLength();
    }
    function updatePromptLength() {
        $("#ai-length").textContent = `${$("#ai-prompt").value.length.toLocaleString()} CHARS`;
    }
    $("#ai-prompt").addEventListener("input", updatePromptLength);
    $("#ai-save").addEventListener("click", async () => {
        try {
            $("#ai-state").textContent = "DEPLOYING";
            await api("/api/gpt-prompt", { method: "POST", body: JSON.stringify({ prompt: $("#ai-prompt").value }) });
            $("#ai-state").textContent = "DEPLOYED";
            toast("AI directive deployed to runtime memory", "success");
            setTimeout(() => $("#ai-state").textContent = "READY", 1800);
        } catch (e) {
            $("#ai-state").textContent = "ERROR";
            toast(e.message, "error");
        }
    });

    $$("[data-export]").forEach(b => b.addEventListener("click", () => {
        window.location.href = `/api/export/${b.dataset.export}`;
        toast("Export requested", "success");
    }));

    $("#import-file").addEventListener("change", () => {
        const file = $("#import-file").files[0];
        if (file) $("#file-drop").querySelector("strong").textContent = file.name;
    });

    $("#import-btn").addEventListener("click", async () => {
        const file = $("#import-file").files[0];
        if (!file) return toast("Select a JSON file first", "warning");
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const type = $("#import-type").value;
            const data = parsed.data || parsed;
            const result = await api(`/api/import/${type}`, { method: "POST", body: JSON.stringify({ data }) });
            $("#import-state").textContent = result.message || "Import completed";
            toast("Data imported successfully", "success");
            await Promise.allSettled([loadSettings(), loadBlacklist(), loadTracking(), loadPermissions()]);
        } catch (e) {
            $("#import-state").textContent = e.message;
            toast(e.message, "error");
        }
    });

    async function loadSystem() {
        const sys = await api("/api/system-info");
        $("#sys-node").textContent = sys.nodeVersion || "—";
        $("#sys-platform").textContent = sys.platform || "—";
        $("#sys-pid").textContent = sys.pid ?? "—";
        $("#sys-rss").textContent = `${sys.rss ?? "—"} MB`;
        $("#sys-memory").textContent = `${sys.memoryUsed ?? "—"} MB`;
        $("#sys-uptime").textContent = formatUptime(sys.uptime);
        $("#sys-logs").textContent = formatNumber(sys.logCount);
        $("#svc-urchin").classList.toggle("online", !!sys.urchinEnabled && !!sys.urchinUrl);
        $("#svc-urchin-text").textContent = sys.urchinEnabled ? (sys.urchinUrl || "Enabled / checking") : "Disabled";
    }

    $("#clear-cache").addEventListener("click", async () => {
        if (!confirm("Clear the runtime API cache? The bot process will remain online.")) return;
        try {
            await api("/api/cache/clear", { method: "POST" });
            toast("Runtime cache cleared", "success");
            await loadStats();
        } catch (e) { toast(e.message, "error"); }
    });

    async function refreshCore(showToast = false) {
        try {
            const results = await Promise.allSettled([loadStats(), api("/api/activity"), api("/api/blacklist")]);
            const activityResult = results[1];
            const blacklistResult = results[2];
            if (activityResult.status === "fulfilled") {
                const recent = activityResult.value.recent || [];
                recent.slice(0, 30).forEach(x => {
                    if (x && x.type && x.message) {
                        const exists = state.logs.some(l => l.msg === x.message && l.time === x.time);
                        if (!exists) state.logs.push({ time: x.time, type: x.type, msg: x.message });
                    }
                });
                state.logs = state.logs.slice(0, 350);
            }
            if (blacklistResult.status === "fulfilled") {
                state.blacklist = blacklistResult.value.entries || [];
                $("#blacklist-count").textContent = blacklistResult.value.total ?? state.blacklist.length;
            }
            calculateHealth();
            if (showToast) toast("Control plane synchronized", "success");
        } catch (e) {
            if (showToast) toast(e.message, "error");
        }
    }

    // Command palette
    const paletteCommands = [
        ["Overview", "overview"], ["Bot Control", "bot"], ["Live Console", "chat"],
        ["Blacklist", "blacklist"], ["Tracking Matrix", "tracking"], ["Access Control", "permissions"],
        ["AI Core", "ai"], ["Data Vault", "data"], ["Event Logs", "logs"], ["System Telemetry", "system"]
    ];
    let paletteIndex = 0;
    function renderPalette(query = "") {
        const filtered = paletteCommands.filter(x => x[0].toLowerCase().includes(query.toLowerCase()));
        paletteIndex = Math.min(paletteIndex, Math.max(0, filtered.length - 1));
        $("#palette-results").innerHTML = filtered.map((x, i) => `
            <button class="palette-result ${i === paletteIndex ? "active" : ""}" data-palette-page="${x[1]}"><span>${escapeHtml(x[0])}</span><small>${String(i + 1).padStart(2, "0")}</small></button>
        `).join("");
        $$("#palette-results button").forEach(b => b.addEventListener("click", () => {
            setPage(b.dataset.palettePage);
            $("#palette").classList.remove("open");
        }));
    }
    function openPalette() {
        $("#palette").classList.add("open");
        $("#palette-input").value = "";
        renderPalette();
        setTimeout(() => $("#palette-input").focus(), 20);
    }
    $("#palette-open").addEventListener("click", openPalette);
    $("#palette").addEventListener("click", e => { if (e.target === $("#palette")) $("#palette").classList.remove("open"); });
    $("#palette-input").addEventListener("input", e => renderPalette(e.target.value));
    $("#palette-input").addEventListener("keydown", e => {
        const items = $$("#palette-results .palette-result");
        if (e.key === "ArrowDown") { e.preventDefault(); paletteIndex = Math.min(items.length - 1, paletteIndex + 1); renderPalette(e.target.value); }
        if (e.key === "ArrowUp") { e.preventDefault(); paletteIndex = Math.max(0, paletteIndex - 1); renderPalette(e.target.value); }
        if (e.key === "Enter" && items[paletteIndex]) items[paletteIndex].click();
        if (e.key === "Escape") $("#palette").classList.remove("open");
    });
    document.addEventListener("keydown", e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
        if (e.key === "Escape") {
            $("#palette").classList.remove("open");
            $("#blacklist-modal").classList.remove("open");
        }
    });

    async function boot() {
        connectSocket();
        try {
            await refreshCore(false);
            await Promise.allSettled([loadSettings(), loadTracking(), loadPermissions(), loadPrompt(), loadSystem()]);
            renderChat();
        } catch (e) {
            toast("Initial sync failed: " + e.message, "error");
        }
        setInterval(() => refreshCore(false), 10000);
        setInterval(() => {
            if (state.page === "system") loadSystem().catch(() => {});
        }, 30000);
    }

    boot();
})();
