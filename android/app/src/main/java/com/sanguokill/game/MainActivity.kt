package com.sanguokill.game

import android.app.Activity
import android.os.Bundle
import android.graphics.Typeface
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

private data class GameCard(val id: Int, val name: String, val description: String)

class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var handBox: LinearLayout
    private lateinit var logBox: LinearLayout
    private val cards = mutableListOf<GameCard>()
    private val log = mutableListOf<String>()
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

    private fun showLobby() {
        val root = column()
        root.addView(text("三国卡牌 · 开发版", 26f, true))
        root.addView(text("原创卡牌规则验证客户端\n当前版本：本地对局测试；在线房间正在开发。", 16f))
        root.addView(button("开始本地对局") { startLocalGame() })
        root.addView(button("玩法与进度") {
            Toast.makeText(this, "当前提供基础本地对局；多人在线功能尚未接入。", Toast.LENGTH_LONG).show()
        })
        setContentView(root)
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
