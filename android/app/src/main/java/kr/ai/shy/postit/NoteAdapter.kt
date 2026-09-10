package kr.ai.shy.postit

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import kr.ai.shy.postit.databinding.ItemNoteBinding
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** 목록에 그릴 한 줄 — 글 + 고정 여부. */
data class NoteRow(val note: Note, val pinned: Boolean)

class NoteAdapter(
    private val onCopy: (Note) -> Unit,
    private val onPin: (Note, Boolean) -> Unit,
    private val onMore: (View, Note) -> Unit
) : ListAdapter<NoteRow, NoteAdapter.Holder>(DIFF) {

    companion object {
        private val DIFF = object : DiffUtil.ItemCallback<NoteRow>() {
            override fun areItemsTheSame(a: NoteRow, b: NoteRow) = a.note.id == b.note.id
            override fun areContentsTheSame(a: NoteRow, b: NoteRow) = a == b
        }

        private val timeFormat = SimpleDateFormat("a h:mm", Locale.KOREA)
        private val dateFormat = SimpleDateFormat("M월 d일 a h:mm", Locale.KOREA)

        fun formatTime(ms: Long): String {
            if (ms <= 0L) return ""
            val then = Calendar.getInstance().apply { timeInMillis = ms }
            val now = Calendar.getInstance()
            val sameDay = then.get(Calendar.YEAR) == now.get(Calendar.YEAR) &&
                then.get(Calendar.DAY_OF_YEAR) == now.get(Calendar.DAY_OF_YEAR)
            val date = Date(ms)
            return if (sameDay) "오늘 " + timeFormat.format(date) else dateFormat.format(date)
        }
    }

    inner class Holder(val binding: ItemNoteBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val inflater = LayoutInflater.from(parent.context)
        return Holder(ItemNoteBinding.inflate(inflater, parent, false))
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val row = getItem(position)
        val b = holder.binding

        b.noteText.text = row.note.text
        b.noteTime.text = formatTime(if (row.note.updatedAt > 0) row.note.updatedAt else row.note.createdAt)

        b.card.setBackgroundResource(
            if (row.pinned) R.drawable.card_bg_pinned else R.drawable.card_bg
        )
        b.pinFlag.visibility = if (row.pinned) View.VISIBLE else View.GONE
        b.btnPin.setText(if (row.pinned) R.string.action_unpin else R.string.action_pin)

        b.btnCopy.setOnClickListener { onCopy(row.note) }
        b.btnPin.setOnClickListener { onPin(row.note, row.pinned) }
        b.btnMore.setOnClickListener { onMore(it, row.note) }
    }
}
