package kr.ai.shy.postit

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.DatabaseReference
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ServerValue
import com.google.firebase.database.ValueEventListener
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException

/** 저장된 글 하나. 웹앱의 users/{uid}/notes/{id} 와 같은 모양입니다. */
data class Note(
    val id: String,
    val text: String,
    val createdAt: Long,
    val updatedAt: Long
)

/**
 * 위젯이 그려야 할 상태. 네트워크가 없으면 마지막으로 받아 둔 값을 씁니다.
 * [stale] 은 서버에서 받지 못하고 캐시로 대신했다는 뜻이며, 저장하지 않습니다.
 */
data class WidgetState(
    val kind: Kind,
    val text: String = "",
    val syncedAt: Long = 0L,
    val stale: Boolean = false
) {
    enum class Kind { SIGNED_OUT, NOTHING_PINNED, OK }
}

object Repo {

    private const val PREFS = "postit.widget"
    private const val KEY_KIND = "kind"
    private const val KEY_TEXT = "text"
    private const val KEY_SYNCED_AT = "syncedAt"

    /** 위젯을 눌러 앱이 새로 뜰 때 서버 연결을 기다리는 최대 시간 */
    private const val CONNECT_TIMEOUT_MS = 10_000L

    /* ---------- Firebase ---------- */

    val auth: FirebaseAuth get() = FirebaseAuth.getInstance()

    fun uid(): String? = auth.currentUser?.uid

    private fun userRef(uid: String): DatabaseReference =
        FirebaseDatabase.getInstance().reference.child("users").child(uid)

    fun notesRef(uid: String): DatabaseReference = userRef(uid).child("notes")

    fun pinnedRef(uid: String): DatabaseReference = userRef(uid).child("pinned")

    fun rootRef(uid: String): DatabaseReference = userRef(uid)

    /**
     * 새 글을 저장하고 그 id 를 돌려줍니다. 새 글은 곧바로 위젯에 고정됩니다.
     * 한 번의 쓰기로 묶어 글만 저장되고 고정이 빠지는 일이 없게 합니다.
     */
    suspend fun addNote(uid: String, text: String): String {
        val id = notesRef(uid).push().key!!
        rootRef(uid).updateChildren(
            mapOf(
                "notes/$id" to mapOf(
                    "text" to text,
                    "createdAt" to ServerValue.TIMESTAMP,
                    "updatedAt" to ServerValue.TIMESTAMP
                ),
                "pinned" to id
            )
        ).await()
        return id
    }

    suspend fun updateNote(uid: String, id: String, text: String) {
        notesRef(uid).child(id)
            .updateChildren(mapOf("text" to text, "updatedAt" to ServerValue.TIMESTAMP))
            .await()
    }

    suspend fun deleteNote(uid: String, id: String) {
        deleteNotes(uid, listOf(id))
    }

    /**
     * 여러 글을 한 번의 쓰기로 지웁니다.
     * 고정된 글이 포함돼 있으면 같은 쓰기에서 고정도 함께 해제하므로,
     * 중간 상태(없는 글을 가리키는 pinned)가 생기지 않습니다.
     */
    suspend fun deleteNotes(uid: String, ids: List<String>) {
        if (ids.isEmpty()) return

        val updates = mutableMapOf<String, Any?>()
        for (id in ids) updates["notes/$id"] = null

        val pinned = pinnedRef(uid).get().await().getValue(String::class.java)
        if (pinned != null && pinned in ids) updates["pinned"] = null

        rootRef(uid).updateChildren(updates).await()
    }

    suspend fun setPinned(uid: String, id: String?) {
        pinnedRef(uid).setValue(id).await()
    }

    /**
     * 서버와 실제로 연결될 때까지 기다립니다.
     *
     * 위젯을 눌러 앱 프로세스가 새로 뜨면 연결에 몇 초가 걸리는데, 그 전에 부른 get() 은
     * 약 3초 만에 "Client is offline" 으로 실패합니다. 그러면 예전 캐시가 복사되므로,
     * 연결을 먼저 확인한 뒤에 읽습니다.
     */
    private suspend fun awaitConnected(): Boolean {
        val db = FirebaseDatabase.getInstance()
        db.goOnline()
        val ref = db.getReference(".info/connected")
        val connected = callbackFlow {
            val listener = object : ValueEventListener {
                override fun onDataChange(snapshot: DataSnapshot) {
                    trySend(snapshot.getValue(Boolean::class.java) == true)
                }

                override fun onCancelled(error: DatabaseError) {
                    close(error.toException())
                }
            }
            ref.addValueEventListener(listener)
            awaitClose { ref.removeEventListener(listener) }
        }
        return withTimeoutOrNull(CONNECT_TIMEOUT_MS) { connected.first { it } } == true
    }

    /** 위젯이 표시하거나 복사할 최신 텍스트를 서버에서 한 번 읽어 옵니다. */
    suspend fun fetchWidgetState(): WidgetState {
        val uid = uid() ?: return WidgetState(WidgetState.Kind.SIGNED_OUT)
        if (!awaitConnected()) throw IOException("서버에 연결하지 못했습니다.")

        val pinnedId = pinnedRef(uid).get().await().getValue(String::class.java)
        if (pinnedId.isNullOrEmpty()) return WidgetState(WidgetState.Kind.NOTHING_PINNED)

        val text = notesRef(uid).child(pinnedId).child("text").get().await()
            .getValue(String::class.java)
        if (text.isNullOrEmpty()) return WidgetState(WidgetState.Kind.NOTHING_PINNED)

        return WidgetState(WidgetState.Kind.OK, text, System.currentTimeMillis())
    }

    /* ---------- 위젯용 로컬 캐시 ---------- */

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun readCache(context: Context): WidgetState {
        val p = prefs(context)
        val kind = runCatching { WidgetState.Kind.valueOf(p.getString(KEY_KIND, null) ?: "") }
            .getOrDefault(WidgetState.Kind.SIGNED_OUT)
        return WidgetState(kind, p.getString(KEY_TEXT, "") ?: "", p.getLong(KEY_SYNCED_AT, 0L))
    }

    fun writeCache(context: Context, state: WidgetState) {
        prefs(context).edit()
            .putString(KEY_KIND, state.kind.name)
            .putString(KEY_TEXT, state.text)
            .putLong(KEY_SYNCED_AT, if (state.syncedAt > 0) state.syncedAt else System.currentTimeMillis())
            .apply()
    }

    fun clearCache(context: Context) {
        writeCache(context, WidgetState(WidgetState.Kind.SIGNED_OUT))
    }

    /**
     * 서버에서 최신 상태를 받아 캐시에 넣고 돌려줍니다.
     * 네트워크 오류 등으로 실패하면 캐시에 있던 값을 그대로 돌려줍니다.
     */
    suspend fun syncWidgetState(context: Context): WidgetState {
        return try {
            val fresh = fetchWidgetState()
            writeCache(context, fresh)
            fresh
        } catch (t: Throwable) {
            readCache(context).copy(stale = true)
        }
    }
}
