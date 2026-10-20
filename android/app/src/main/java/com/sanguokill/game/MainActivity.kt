package com.sanguokill.game

import android.app.Activity
import android.os.Bundle
import android.graphics.Typeface
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.ArrayAdapter
import android.widget.TextView
import android.widget.Toast
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

private data class GameCard(val id: Int, val name: String, val description: String)

class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var handBox: LinearLayout
    private lateinit var logBox: LinearLayout
    private lateinit var onlineStatus: TextView
    private lateinit var serverUrlInput: EditText
    private lateinit var playerNameInput: EditText
    private lateinit var roomCodeInput: EditText
    private lateinit var maxPlayersInput: EditText
    private lateinit var modeInput: Spinner
    private val cards = mutableListOf<GameCard>()
    private val log = mutableListOf<String>()
    private val httpClient = OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build()
    private var webSocket: WebSocket? = null
    private var pendingMessage: String? = null
    private var playerToken: String? = null
    private var playerId: String? = null
    private var selectedTargetId: String? = null
    private var latestRoomState: JSONObject? = null
    private var serverUrlValue = "ws://10.0.2.2:3000/ws"
    private var playerNameValue = "玩家"
    private var roomCodeValue = ""
    private var maxPlayersValue = "3"
    private var modeValue = "standard"
    private var hp = 4
    private var opponentHp = 4
    private var turn = 1
    private var started = false
    private var finished = false
    private var nextId = 1

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showLobby()
    }

    override fun onDestroy() {
        webSocket?.close(1000, "activity destroyed")
        webSocket = null
        httpClient.dispatcher.executorService.shutdown()
        super.onDestroy()
    }

    private fun text(value: String, size: Float = 16f, bold: Boolean = false): TextView =
        TextView(this).apply {
            text = value
            textSize = size
            if (bold) setTypeface(typeface, Typeface.BOLD)
            setPadding(12, 8, 12, 8)
        }

    private fun button(label: String, action: () -> Unit): Button =
        Button(this).apply { text = label; setOnClickListener { action() } }

    private fun column(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(16, 12, 16, 16)
    }

    private fun input(hintText: String, value: String): EditText =
        EditText(this).apply { hint = hintText; setText(value); setSingleLine(true) }

    private fun showLobby() {
        val root = column()
        root.addView(text("三国卡牌 · 开发版", 26f, true))
        root.addView(text("本地对局可直接体验；在线房间需要先运行或部署游戏服务端。", 16f))
        root.addView(button("开始本地对局") { startLocalGame() })
        root.addView(button("多人在线房间") { showOnlineLobby() })
        root.addView(button("项目说明") {
            Toast.makeText(this, "这是早期开发版，基础包、军争包及完整身份/技能规则仍在开发。", Toast.LENGTH_LONG).show()
        })
        setContentView(root)
    }

    private fun showOnlineLobby() {
        val root = column()
        root.addView(text("多人在线 · 连接设置", 23f, true))
        root.addView(text("服务端地址（模拟器默认值；真机请填写可访问的服务器地址）", 14f))
        serverUrlInput = input("ws://主机地址:3000/ws", serverUrlValue)
        root.addView(serverUrlInput)
        playerNameInput = input("玩家昵称", playerNameValue)
        root.addView(playerNameInput)
        maxPlayersInput = input("房间人数 3～10（斗地主固定 3 人）", maxPlayersValue)
        root.addView(maxPlayersInput)
        root.addView(text("游戏模式", 15f, true))
        modeInput = Spinner(this)
        modeInput.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, listOf("身份模式", "斗地主模式（3 人）", "双将模式（规则开发中）"))
        modeInput.setSelection(when (modeValue) { "duel_lord" -> 1; "double_general" -> 2; else -> 0 })
        root.addView(modeInput)
        roomCodeInput = input("加入房间时填写房间码", roomCodeValue)
        root.addView(roomCodeInput)
        onlineStatus = text("未连接。当前尚未部署公共服务器。", 14f)
        root.addView(onlineStatus)
        root.addView(button("创建房间") {
            saveOnlineInputs()
            val count = maxPlayersValue.toIntOrNull()?.coerceIn(3, 10) ?: 3
            connectAndSend(JSONObject()
                .put("type", "create_room")
                .put("name", playerNameValue)
                .put("mode", modeValue)
                .put("maxPlayers", if (modeValue == "duel_lord") 3 else count).toString())
        })
        root.addView(button("加入房间") {
            saveOnlineInputs()
            if (roomCodeValue.isBlank()) {
                Toast.makeText(this, "请先填写房间码。", Toast.LENGTH_SHORT).show()
            } else {
                connectAndSend(JSONObject().put("type", "join_room")
                    .put("name", playerNameValue).put("code", roomCodeValue).toString())
            }
        })
        if (playerToken != null) {
            root.addView(button("重连上次房间") {
                saveOnlineInputs()
                connectAndSend(JSONObject().put("type", "reconnect").put("token", playerToken).toString())
            })
        }
        root.addView(button("返回主菜单") { showLobby() })
        setContentView(ScrollView(this).apply { addView(root) })
    }

    private fun saveOnlineInputs() {
        serverUrlValue = serverUrlInput.text.toString().trim()
        playerNameValue = playerNameInput.text.toString().trim().ifBlank { "玩家" }
        maxPlayersValue = maxPlayersInput.text.toString().trim()
        roomCodeValue = roomCodeInput.text.toString().trim().uppercase()
        modeValue = when (modeInput.selectedItemPosition) { 1 -> "duel_lord"; 2 -> "double_general"; else -> "standard" }
    }

    private fun connectAndSend(message: String) {
        val existing = webSocket
        if (existing != null) {
            if (!existing.send(message)) showToast("发送失败，请重新连接。")
            return
        }
        pendingMessage = message
        val request = try {
            Request.Builder().url(serverUrlValue).build()
        } catch (e: Exception) {
            pendingMessage = null
            showToast("服务端地址无效：${e.message}")
            return
        }
        runOnUiThread { onlineStatus.text = "正在连接服务器……" }
        val created = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(socket: WebSocket, response: Response) {
                webSocket = socket
                val firstMessage = pendingMessage
                pendingMessage = null
                if (firstMessage != null) socket.send(firstMessage)
                runOnUiThread { if (latestRoomState == null) onlineStatus.text = "已连接，等待服务器响应……" }
            }

            override fun onMessage(socket: WebSocket, text: String) {
                try {
                    val messageObject = JSONObject(text)
                    when (messageObject.optString("type")) {
                        "welcome" -> {
                            playerToken = messageObject.optString("token").takeIf { it.isNotBlank() }
                            playerId = messageObject.optString("playerId").takeIf { it.isNotBlank() }
                            latestRoomState = messageObject.optJSONObject("state")
                            runOnUiThread { latestRoomState?.let { renderOnlineState(it) } }
                        }
                        "room_state" -> {
                            latestRoomState = messageObject.optJSONObject("state")
                            runOnUiThread { latestRoomState?.let { renderOnlineState(it) } }
                        }
                        "error" -> showToast(messageObject.optString("message", "操作失败"))
                        "left_room" -> {
                            latestRoomState = null
                            playerToken = null
                            playerId = null
                            runOnUiThread { showOnlineLobby() }
                        }
                    }
                } catch (e: Exception) {
                    showToast("服务器返回的数据无法解析。")
                }
            }

            override fun onFailure(socket: WebSocket, t: Throwable, response: Response?) {
                if (webSocket === socket) webSocket = null
                pendingMessage = null
                runOnUiThread {
                    if (playerToken != null) {
                        showOnlineLobby()
                        onlineStatus.text = "连接失败或已断开，可检查地址后重连。"
                    } else {
                        Toast.makeText(this@MainActivity, "连接失败：${t.message ?: "请检查服务器地址与网络"}", Toast.LENGTH_LONG).show()
                    }
                }
            }

            override fun onClosed(socket: WebSocket, code: Int, reason: String) {
                if (webSocket === socket) webSocket = null
            }
        })
        if (webSocket == null) webSocket = created
    }

    private fun sendOnlineMessage(message: JSONObject) {
        val socket = webSocket
        if (socket == null) {
            showToast("尚未连接服务器。")
            return
        }
        if (!socket.send(message.toString())) showToast("发送失败，请检查网络。")
    }

    private fun renderOnlineState(state: JSONObject) {
        latestRoomState = state
        val root = column()
        root.addView(text("在线房间 · " + state.optString("code"), 23f, true))
        root.addView(text("模式：" + modeLabel(state.optString("mode")) + "    状态：" + state.optString("status"), 15f))
        val players = state.optJSONArray("players")
        val playerLines = mutableListOf<String>()
        if (players != null) {
            for (i in 0 until players.length()) {
                val p = players.optJSONObject(i) ?: continue
                val hostMark = if (p.optBoolean("host")) "（房主）" else ""
                val connection = if (p.optBoolean("connected")) "在线" else "断线"
                val armor = p.optString("armor").takeIf { it.isNotBlank() && it != "null" }?.let { " · 装备 $it" } ?: ""
                val role = p.optString("role").takeIf { it.isNotBlank() && it != "null" }
                val roleText = role?.let { " · 身份 ${roleLabel(it)}" } ?: ""
                playerLines.add("${p.optString("name")}$hostMark · 体力 ${p.optInt("hp", 4)} · 手牌 ${p.optInt("handCount")} · $connection$armor$roleText")
            }
        }
        root.addView(text(playerLines.joinToString("\n").ifBlank { "等待玩家加入……" }, 15f))
        val eventLog = state.optJSONArray("log")
        if (eventLog != null && eventLog.length() > 0) {
            root.addView(text("对局记录", 17f, true))
            val from = (eventLog.length() - 8).coerceAtLeast(0)
            for (i in from until eventLog.length()) {
                val event = eventLog.optJSONObject(i) ?: continue
                root.addView(text("· " + describeEvent(event), 13f))
            }
        }
        root.addView(button("复制房间码") {
            val clipboard = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("房间码", state.optString("code")))
            showToast("房间码已复制。")
        })
        if (state.optString("status") == "waiting" && state.optString("hostId") == playerId) {
            root.addView(button("开始游戏（至少 3 名玩家）") {
                sendOnlineMessage(JSONObject().put("type", "start_game"))
            })
        }
        if (state.optString("status") == "finished") {
            root.addView(text("对局结束 · 胜利阵营：${sideLabel(state.optString("winningSide"))}", 18f, true))
        }
        val pending = state.optJSONObject("pendingResponse")
        if (pending != null) {
            val responseType = pending.optString("type")
            val responsePlayer = pending.optString("responsePlayerId")
            val targetName = players?.let { array ->
                (0 until array.length()).mapNotNull { array.optJSONObject(it) }
                    .firstOrNull { it.optString("id") == pending.optString("targetId") }?.optString("name")
            } ?: "玩家"
            val message = if (responseType == "dodge") "【杀】目标 $targetName 需要打出【闪】或放弃响应。"
                else "玩家 $targetName 濒死，当前等待救援玩家。"
            root.addView(text(message, 16f, true))
            if (responsePlayer == playerId) {
                root.addView(button(if (responseType == "dodge") "不出【闪】" else "放弃救援") {
                    val action = if (responseType == "dodge")
                        JSONObject().put("type", "respond").put("response", "pass")
                    else JSONObject().put("type", "rescue").put("response", "pass")
                    sendOnlineMessage(JSONObject().put("type", "action").put("action", action))
                })
                root.addView(text(if (responseType == "dodge") "点击手牌中的【闪】进行响应。" else "点击手牌中的【桃】救援。", 14f))
            } else {
                root.addView(text("正在等待其他玩家响应，暂时不能操作。", 14f))
            }
        }
        if (state.optString("status") == "playing") {
            root.addView(text("当前行动玩家：" + state.optString("currentPlayerId") + "    回合：" + state.optInt("turnNumber"), 15f, true))
            root.addView(text("攻击目标（点击选择）", 16f, true))
            if (players != null) {
                for (i in 0 until players.length()) {
                    val candidate = players.optJSONObject(i) ?: continue
                    val candidateId = candidate.optString("id")
                    if (candidateId == playerId || !candidate.optBoolean("alive", true)) continue
                    val selected = candidateId == selectedTargetId
                    root.addView(button((if (selected) "✓ " else "") + candidate.optString("name") + " · 体力 " + candidate.optInt("hp", 4)) {
                        selectedTargetId = candidateId
                        renderOnlineState(state)
                    })
                }
            }
            root.addView(button("摸一张牌") {
                sendOnlineMessage(JSONObject().put("type", "action").put("action", JSONObject().put("type", "draw")))
            })
            root.addView(button("结束回合") {
                sendOnlineMessage(JSONObject().put("type", "action").put("action", JSONObject().put("type", "end_turn")))
            })
            root.addView(text("你的手牌（点击使用）", 18f, true))
            val ownPlayer = players?.let { array ->
                (0 until array.length()).mapNotNull { array.optJSONObject(it) }.firstOrNull { it.optString("id") == playerId }
            }
            val hand = ownPlayer?.optJSONArray("hand")
            if (hand != null) {
                for (i in 0 until hand.length()) {
                    val card = hand.optJSONObject(i) ?: continue
                    val cardId = card.optString("id")
                    val cardName = card.optString("name")
                    val kind = card.optString("kind")
                    root.addView(button("【$cardName】 · ${kindLabel(kind)}") {
                        val pendingNow = latestRoomState?.optJSONObject("pendingResponse")
                        val isExpectedResponder = pendingNow?.optString("responsePlayerId") == playerId
                        if (kind == "dodge" && pendingNow?.optString("type") == "dodge" && isExpectedResponder) {
                            sendOnlineMessage(JSONObject().put("type", "action").put("action",
                                JSONObject().put("type", "respond").put("response", "dodge").put("cardId", cardId)))
                        } else if (kind == "heal" && pendingNow?.optString("type") == "rescue" && isExpectedResponder) {
                            sendOnlineMessage(JSONObject().put("type", "action").put("action",
                                JSONObject().put("type", "rescue").put("response", "save").put("cardId", cardId)))
                        } else if (kind == "dodge") {
                            showToast("【闪】只能在受到【杀】时响应。")
                        } else {
                            val action = JSONObject().put("type", "play_card").put("cardId", cardId)
                            if (kind == "attack" || kind == "steal") {
                                val target = players?.let { array ->
                                    (0 until array.length()).mapNotNull { array.optJSONObject(it) }
                                        .firstOrNull { it.optString("id") == selectedTargetId && it.optBoolean("alive", true) }
                                        ?: (0 until array.length()).mapNotNull { array.optJSONObject(it) }
                                            .firstOrNull { it.optString("id") != playerId && it.optBoolean("alive", true) }
                                }
                                if (target == null) {
                                    showToast("没有可攻击的目标。")
                                    return@button
                                }
                                action.put("targetId", target.optString("id"))
                            }
                            sendOnlineMessage(JSONObject().put("type", "action").put("action", action))
                        }
                    })
                }
            } else {
                root.addView(text("等待服务器同步你的手牌。", 14f))
            }
        }
        root.addView(button("离开 / 返回连接页") {
            if (playerToken != null) sendOnlineMessage(JSONObject().put("type", "leave_room"))
            else showOnlineLobby()
        })
        setContentView(ScrollView(this).apply { addView(root) })
    }

    private fun describeEvent(event: JSONObject): String {
        val type = event.optString("type")
        return when (type) {
            "game_started" -> "对局开始"
            "turn_started" -> "轮到玩家 " + event.optString("playerId")
            "card_played" -> "玩家 " + event.optString("playerId") + " 使用了卡牌"
            "response_requested" -> "玩家 " + event.optString("targetId") + " 需要响应【杀】"
            "attack_evaded" -> "玩家 " + event.optString("targetId") + " 用【闪】躲过攻击"
            "damage" -> "玩家 " + event.optString("targetId") + " 受到 " + event.optInt("amount") + " 点伤害"
            "healed" -> "玩家 " + event.optString("playerId") + " 回复体力"
            "rescue" -> "玩家 " + event.optString("rescuerId") + " 救援了玩家 " + event.optString("targetId")
            "player_dying" -> "玩家 " + event.optString("playerId") + " 进入濒死状态"
            "player_died" -> "玩家 " + event.optString("playerId") + " 阵亡"
            "card_stolen" -> "玩家 " + event.optString("playerId") + " 获得目标一张手牌"
            "armor_blocked" -> "玩家 " + event.optString("targetId") + " 的护心镜抵挡了攻击"
            "equipment_equipped" -> "玩家 " + event.optString("playerId") + " 装备了护心镜"
            "cards_drawn" -> "玩家 " + event.optString("playerId") + " 摸了 " + event.optInt("count") + " 张牌"
            "game_finished" -> "对局结束，胜利阵营：" + sideLabel(event.optString("winningSide"))
            else -> type
        }
    }

    private fun roleLabel(role: String): String = when (role) {
        "lord" -> "主公"
        "loyalist" -> "忠臣"
        "rebel" -> "反贼"
        "renegade" -> "内奸"
        "landlord" -> "地主"
        "peasant" -> "农民"
        else -> role
    }

    private fun modeLabel(mode: String): String = when (mode) {
        "duel_lord" -> "斗地主"
        "double_general" -> "双将"
        else -> "身份模式"
    }

    private fun sideLabel(side: String): String = when (side) {
        "lord" -> "主公阵营"
        "rebels" -> "反贼阵营"
        "renegade" -> "内奸"
        "landlord" -> "地主阵营"
        "peasants" -> "农民阵营"
        else -> "尚未判定"
    }

    private fun kindLabel(kind: String): String = when (kind) {
        "attack" -> "攻击"
        "heal" -> "回复"
        "dodge" -> "闪避"
        "draw2" -> "摸两张牌"
        "steal" -> "获得目标随机一张手牌"
        "armor" -> "装备：抵挡下一次【杀】"
        else -> kind
    }

    private fun showToast(message: String) {
        runOnUiThread { Toast.makeText(this, message, Toast.LENGTH_LONG).show() }
    }

    private fun startLocalGame() {
        hp = 4
        opponentHp = 4
        turn = 1
        finished = false
        started = true
        nextId = 1
        cards.clear()
        log.clear()
        repeat(4) { drawCard() }
        addLog("对局开始：双方初始体力 4。")
        renderGame()
    }

    private fun drawCard() {
        val pool = listOf(
            "杀" to "对对手造成 1 点伤害",
            "桃" to "恢复 1 点体力，最多 4 点",
            "闪" to "当前版本保留为防御牌"
        )
        val chosen = pool[(nextId * 7 + turn * 3) % pool.size]
        cards.add(GameCard(nextId++, chosen.first, chosen.second))
    }

    private fun renderGame() {
        val root = column()
        root.addView(text("三国卡牌 · 本地对局", 23f, true))
        status = text("", 17f, true)
        root.addView(status)
        root.addView(text("对手手牌：未知 · 当前为本地规则测试", 14f))
        root.addView(button("摸一张牌") {
            if (canAct()) { drawCard(); addLog("你摸了一张牌。"); renderGame() }
        })
        root.addView(button("结束回合") {
            if (canAct()) {
                turn++
                drawCard()
                addLog("回合 " + turn + " 开始，你摸了一张牌。")
                renderGame()
            }
        })
        root.addView(text("你的手牌（点击使用）", 18f, true))
        handBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(handBox)
        root.addView(text("对局记录", 18f, true))
        logBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(logBox)
        root.addView(button("返回主菜单") { showLobby() })
        val scroll = ScrollView(this)
        scroll.addView(root)
        setContentView(scroll)
        updateStatus()
        renderHand()
        renderLog()
    }

    private fun canAct(): Boolean {
        if (!started || finished) {
            Toast.makeText(this, "当前没有进行中的对局。", Toast.LENGTH_SHORT).show()
            return false
        }
        return true
    }

    private fun useCard(card: GameCard) {
        if (!canAct()) return
        when (card.name) {
            "杀" -> {
                opponentHp--
                addLog("你使用【杀】，对手体力 -1。")
            }
            "桃" -> {
                val before = hp
                hp = (hp + 1).coerceAtMost(4)
                addLog(if (hp == before) "你使用【桃】，体力已满。" else "你使用【桃】，体力 +1。")
            }
            "闪" -> addLog("【闪】目前不能主动使用，响应规则将在后续版本实现。")
        }
        if (card.name != "闪") cards.removeAll { it.id == card.id }
        if (opponentHp <= 0) {
            finished = true
            addLog("本地测试对局结束：你获胜。")
        }
        renderGame()
    }

    private fun updateStatus() {
        status.text = "你的体力：" + hp + " / 4    对手体力：" + opponentHp + " / 4\n回合：" + turn
    }

    private fun renderHand() {
        handBox.removeAllViews()
        cards.forEach { card ->
            handBox.addView(button("【" + card.name + "】  " + card.description) { useCard(card) })
        }
        if (cards.isEmpty()) handBox.addView(text("手牌为空，请摸牌。"))
    }

    private fun addLog(message: String) {
        log.add(0, message)
        if (::logBox.isInitialized) renderLog()
    }

    private fun renderLog() {
        logBox.removeAllViews()
        log.take(12).forEach { logBox.addView(text("· " + it, 14f)) }
    }
}
