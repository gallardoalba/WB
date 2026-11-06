package org.wanderbibliothek.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.wanderbibliothek.app.data.ClubBundle
import org.wanderbibliothek.app.data.ClubPost
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.Fmt
import org.wanderbibliothek.app.ui.LocalLang
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.components.ActionButton
import org.wanderbibliothek.app.ui.components.EmptyBox
import org.wanderbibliothek.app.ui.components.ErrorBox
import org.wanderbibliothek.app.ui.components.FormField
import org.wanderbibliothek.app.ui.components.LoadingBox
import org.wanderbibliothek.app.ui.components.MetaRow
import org.wanderbibliothek.app.ui.components.Notice
import org.wanderbibliothek.app.ui.components.Pill
import org.wanderbibliothek.app.ui.components.SecondaryButton
import org.wanderbibliothek.app.ui.components.SectionTitle
import org.wanderbibliothek.app.ui.errorText

@Composable
fun ClubDetailScreen(viewModel: AppViewModel, clubId: String) {
    val texts = LocalTexts.current
    val lang = LocalLang.current
    val scope = rememberCoroutineScope()

    var bundle by remember { mutableStateOf<ClubBundle?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var reloads by remember { mutableIntStateOf(0) }
    var draft by remember { mutableStateOf("") }

    LaunchedEffect(clubId, reloads) {
        loading = true
        error = null
        try {
            bundle = viewModel.repo.club(clubId)
        } catch (failure: Exception) {
            error = errorText(texts, failure)
        } finally {
            loading = false
        }
    }

    when {
        loading -> LoadingBox(texts, Modifier.fillMaxSize())
        error != null -> ErrorBox(
            message = error.orEmpty(),
            retry = texts["retry"],
            onRetry = { reloads += 1 },
            modifier = Modifier.padding(16.dp),
        )
        bundle == null -> EmptyBox(texts["notFound"], Modifier.fillMaxSize())
        else -> {
            val data = bundle!!
            val club = data.club
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = club.name,
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = club.city,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (club.description.isNotBlank()) {
                            Text(club.description, style = MaterialTheme.typography.bodyMedium)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Pill("${club.members} ${texts["members"]}")
                            if (club.isMember) Pill(texts["member"])
                            if (club.isMine) Pill(texts["moderator"])
                        }
                        MetaRow(texts["founder"], club.ownerName)
                        MetaRow(
                            texts["meetsOn"],
                            if (club.meetsAt.isNotBlank()) Fmt.dateTime(club.meetsAt, lang) else club.meetsOn,
                        )
                        MetaRow(texts["place"], club.meetsPlace)
                        if (club.bookTitle != null) {
                            MetaRow(texts["currentBook"], "${club.bookTitle} · ${club.bookAuthor.orEmpty()}")
                        }
                        if (club.progress > 0) {
                            LinearProgressIndicator(
                                progress = { club.progress / 100f },
                                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                            )
                            Text(
                                text = "${texts["progress"]}: ${club.progress} %",
                                style = MaterialTheme.typography.labelSmall,
                            )
                        }
                    }
                }

                notice?.let { item { Notice(it) } }

                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        when {
                            club.myStatus == "member" && !club.isMine -> SecondaryButton(
                                text = texts["leave"],
                                enabled = !busy,
                                modifier = Modifier.weight(1f),
                                onClick = {
                                    scope.launch {
                                        busy = true
                                        try {
                                            viewModel.repo.joinClub(club.id, false)
                                            reloads += 1
                                        } catch (failure: Exception) {
                                            notice = errorText(texts, failure)
                                        } finally {
                                            busy = false
                                        }
                                    }
                                },
                            )
                            club.myStatus == "pending" -> Notice(texts["pendingApproval"])
                            club.myStatus == "none" -> ActionButton(
                                text = texts["join"],
                                enabled = !busy,
                                modifier = Modifier.weight(1f),
                                onClick = {
                                    scope.launch {
                                        busy = true
                                        try {
                                            viewModel.repo.joinClub(club.id, true)
                                            reloads += 1
                                        } catch (failure: Exception) {
                                            notice = errorText(texts, failure)
                                        } finally {
                                            busy = false
                                        }
                                    }
                                },
                            )
                        }
                    }
                }

                if (club.isMember) {
                    item {
                        SecondaryButton(
                            text = if (club.attending) {
                                "✓ ${texts["attendance"]} (${club.attendees})"
                            } else {
                                "${texts["attendance"]} (${club.attendees})"
                            },
                            enabled = !busy,
                            onClick = {
                                scope.launch {
                                    busy = true
                                    try {
                                        viewModel.repo.setAttendance(club.id, !club.attending)
                                        reloads += 1
                                    } catch (failure: Exception) {
                                        notice = errorText(texts, failure)
                                    } finally {
                                        busy = false
                                    }
                                }
                            },
                        )
                    }
                }

                val poll = data.poll
                if (poll != null) {
                    item {
                        SectionTitle(texts["poll"])
                        Text(poll.question, style = MaterialTheme.typography.bodyMedium)
                    }
                    items(poll.options, key = { it.id }) { option ->
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            onClick = {
                                scope.launch {
                                    busy = true
                                    try {
                                        viewModel.repo.votePoll(club.id, poll.id, option.id)
                                        reloads += 1
                                    } catch (failure: Exception) {
                                        notice = errorText(texts, failure)
                                    } finally {
                                        busy = false
                                    }
                                }
                            },
                        ) {
                            Row(
                                modifier = Modifier.padding(10.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text(
                                    text = if (poll.votedOptionId == option.id) "✓" else "·",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                                Column(Modifier.weight(1f)) {
                                    Text(option.title, style = MaterialTheme.typography.bodyMedium)
                                    Text(
                                        text = option.author,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Text(
                                    text = texts.format("votes", option.votes),
                                    style = MaterialTheme.typography.labelSmall,
                                )
                            }
                        }
                    }
                }

                if (club.isMember) {
                    item {
                        SectionTitle(texts["forum"])
                        FormField(draft, { draft = it }, texts["postMessage"], singleLine = false)
                        ActionButton(
                            text = texts["send"],
                            enabled = !busy && draft.trim().length >= 2,
                            onClick = {
                                val body = draft.trim()
                                scope.launch {
                                    busy = true
                                    try {
                                        viewModel.repo.postToClub(club.id, body)
                                        draft = ""
                                        reloads += 1
                                    } catch (failure: Exception) {
                                        notice = errorText(texts, failure)
                                    } finally {
                                        busy = false
                                    }
                                }
                            },
                        )
                    }
                    if (data.posts.isEmpty()) {
                        item { EmptyBox(texts["noPosts"]) }
                    } else {
                        items(data.posts, key = { it.id }) { post ->
                            PostCard(post, lang)
                            post.replies.forEach { reply ->
                                Box { PostCard(reply, lang, indented = true) }
                            }
                        }
                    }
                }

                if (data.requests.isNotEmpty()) {
                    item { SectionTitle(texts["requestsToJoin"]) }
                    items(data.requests, key = { it.userId }) { request ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                text = "${request.name} · ${request.city}",
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.weight(1f),
                            )
                            SecondaryButton(
                                text = texts["reject"],
                                modifier = Modifier.weight(0.4f),
                                onClick = {
                                    scope.launch {
                                        try {
                                            viewModel.repo.decideMembership(club.id, request.userId, false)
                                            reloads += 1
                                        } catch (failure: Exception) {
                                            notice = errorText(texts, failure)
                                        }
                                    }
                                },
                            )
                            ActionButton(
                                text = texts["approve"],
                                modifier = Modifier.weight(0.4f),
                                onClick = {
                                    scope.launch {
                                        try {
                                            viewModel.repo.decideMembership(club.id, request.userId, true)
                                            reloads += 1
                                        } catch (failure: Exception) {
                                            notice = errorText(texts, failure)
                                        }
                                    }
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PostCard(post: ClubPost, lang: String, indented: Boolean = false) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = if (indented) 20.dp else 0.dp),
    ) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                text = "${post.authorName} · ${Fmt.relative(post.createdAt, lang)}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = if (post.deleted) "…" else post.body,
                style = MaterialTheme.typography.bodyMedium,
            )
            if (post.likes > 0) {
                Text(
                    text = "♥ ${post.likes}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}
