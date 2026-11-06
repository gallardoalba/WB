package org.wanderbibliothek.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.wanderbibliothek.app.data.Club
import org.wanderbibliothek.app.data.Community
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.Fmt
import org.wanderbibliothek.app.ui.LocalLang
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.SessionState
import org.wanderbibliothek.app.ui.Texts
import org.wanderbibliothek.app.ui.components.ChoiceChips
import org.wanderbibliothek.app.ui.components.EmptyBox
import org.wanderbibliothek.app.ui.components.ErrorBox
import org.wanderbibliothek.app.ui.components.FormField
import org.wanderbibliothek.app.ui.components.LoadingBox
import org.wanderbibliothek.app.ui.components.Pill
import org.wanderbibliothek.app.ui.components.SectionTitle
import org.wanderbibliothek.app.ui.components.SecondaryButton
import org.wanderbibliothek.app.ui.errorText

@Composable
fun ClubsScreen(
    viewModel: AppViewModel,
    session: SessionState,
    onOpenClub: (String) -> Unit,
    onSignIn: () -> Unit,
) {
    val texts = LocalTexts.current
    val lang = LocalLang.current
    val scope = rememberCoroutineScope()

    if (session !is SessionState.SignedIn) {
        SignInPrompt(texts, text = texts["signInToSee"], onSignIn = onSignIn)
        return
    }

    var tab by rememberSaveable { mutableStateOf("clubs") }
    var query by rememberSaveable { mutableStateOf("") }
    var clubs by remember { mutableStateOf<List<Club>>(emptyList()) }
    var community by remember { mutableStateOf<Community?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var reloads by remember { mutableIntStateOf(0) }
    var page by remember { mutableIntStateOf(1) }
    var hasMore by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var pageError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(query, reloads) {
        // Espera también tras un «Reintentar»: si no, cada tecla pedía la lista.
        delay(250)
        loading = true
        error = null
        pageError = null
        try {
            val result = viewModel.repo.clubs(query, page = 1)
            clubs = result.items
            page = 1
            hasMore = result.hasMore
        } catch (failure: Exception) {
            error = errorText(texts, failure)
        } finally {
            loading = false
        }
    }

    LaunchedEffect(tab, reloads) {
        if (tab != "community" || community != null) return@LaunchedEffect
        try {
            community = viewModel.repo.community("region")
        } catch (failure: Exception) {
            error = errorText(texts, failure)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Text(
                text = texts["clubsSubtitle"],
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        item {
            ChoiceChips(
                options = listOf(
                    "clubs" to texts["clubs"],
                    "community" to texts["community"],
                ),
                selected = tab,
                onSelect = { tab = it },
            )
        }

        if (tab == "clubs") {
            item { FormField(query, { query = it }, texts["search"]) }
            when {
                loading -> item { LoadingBox(texts) }
                error != null -> item {
                    ErrorBox(
                        message = error.orEmpty(),
                        retry = texts["retry"],
                        onRetry = { reloads += 1 },
                    )
                }
                clubs.isEmpty() -> item { EmptyBox(texts["emptyClubs"]) }
                else -> {
                    items(clubs, key = { it.id }) { club ->
                        ClubCard(club = club, texts = texts, lang = lang, onClick = { onOpenClub(club.id) })
                    }
                    if (hasMore || pageError != null) {
                        item {
                            pageError?.let {
                                ErrorBox(
                                    message = it,
                                    retry = texts["retry"],
                                    onRetry = { pageError = null },
                                    modifier = Modifier.padding(bottom = 8.dp),
                                )
                            }
                            SecondaryButton(
                                text = texts["loadMore"],
                                enabled = !loadingMore,
                                onClick = {
                                    loadingMore = true
                                    pageError = null
                                    scope.launch {
                                        try {
                                            val next = viewModel.repo.clubs(query, page = page + 1)
                                            clubs = clubs + next.items
                                            page += 1
                                            hasMore = next.hasMore
                                        } catch (failure: Exception) {
                                            pageError = errorText(texts, failure)
                                        } finally {
                                            loadingMore = false
                                        }
                                    }
                                },
                            )
                        }
                    }
                }
            }
        } else {
            val data = community
            if (data == null) {
                item { LoadingBox(texts) }
            } else {
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Pill("${data.stats.available} ${texts["statsAvailable"]}")
                        Pill("${data.stats.members} ${texts["statsMembers"]}")
                        Pill("${data.stats.completed} ${texts["statsCompleted"]}")
                    }
                }
                item { SectionTitle(texts["activity"]) }
                if (data.activity.isEmpty()) {
                    item { EmptyBox(texts["noResults"]) }
                } else {
                    items(data.activity, key = { "act-${it.id}" }) { entry ->
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(10.dp)) {
                                Text(
                                    text = entry.actor,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Text(entry.title, style = MaterialTheme.typography.bodyMedium)
                                Text(
                                    text = Fmt.relative(entry.createdAt, lang),
                                    style = MaterialTheme.typography.labelSmall,
                                )
                            }
                        }
                    }
                }
                item { SectionTitle(texts["conversations"]) }
                if (data.conversations.isEmpty()) {
                    item { EmptyBox(texts["noResults"]) }
                } else {
                    items(data.conversations, key = { "conv-${it.id}" }) { conversation ->
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(10.dp)) {
                                Text(
                                    text = conversation.bookTitle,
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text(
                                    text = conversation.excerpt,
                                    style = MaterialTheme.typography.bodySmall,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    text = "${conversation.authorName} · ${conversation.replies}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
                item { SectionTitle(texts["readers"]) }
                if (data.readers.isEmpty()) {
                    item { EmptyBox(texts["noResults"]) }
                } else {
                    items(data.readers, key = { "reader-${it.id}" }) { reader ->
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Row(
                                modifier = Modifier.padding(10.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(reader.name, style = MaterialTheme.typography.titleSmall)
                                    Text(
                                        text = reader.city,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Pill("${reader.published} ${texts["published"]}")
                                Pill("${reader.followers} ${texts["followers"]}")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ClubCard(
    club: Club,
    texts: Texts,
    lang: String,
    onClick: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth(), onClick = onClick) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                text = club.name,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = club.city,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (club.description.isNotBlank()) {
                Text(
                    text = club.description,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Pill("${club.members} ${texts["members"]}")
                if (club.bookTitle != null) {
                    Pill(club.bookTitle.orEmpty(), container = MaterialTheme.colorScheme.tertiaryContainer)
                }
                if (club.myStatus == "member") {
                    Pill(texts["member"], container = MaterialTheme.colorScheme.primaryContainer)
                }
            }
            if (club.meetsAt.isNotBlank()) {
                Text(
                    text = "${texts["meetsOn"]}: ${Fmt.dateTime(club.meetsAt, lang)}",
                    style = MaterialTheme.typography.labelSmall,
                )
            } else if (club.meetsOn.isNotBlank()) {
                Text(
                    text = "${texts["meetsOn"]}: ${club.meetsOn}",
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        }
    }
}
