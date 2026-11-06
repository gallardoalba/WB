package org.wanderbibliothek.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import org.wanderbibliothek.app.data.ListingDetail
import org.wanderbibliothek.app.data.ReadingList
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.Fmt
import org.wanderbibliothek.app.ui.Labels
import org.wanderbibliothek.app.ui.LocalLang
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.SessionState
import org.wanderbibliothek.app.ui.components.ActionButton
import org.wanderbibliothek.app.ui.components.ChoiceChips
import org.wanderbibliothek.app.ui.components.EmptyBox
import org.wanderbibliothek.app.ui.components.ErrorBox
import org.wanderbibliothek.app.ui.components.ListingCard
import org.wanderbibliothek.app.ui.components.LoadingBox
import org.wanderbibliothek.app.ui.components.MetaRow
import org.wanderbibliothek.app.ui.components.Notice
import org.wanderbibliothek.app.ui.components.Pill
import org.wanderbibliothek.app.ui.components.RemoteCover
import org.wanderbibliothek.app.ui.components.SecondaryButton
import org.wanderbibliothek.app.ui.components.SectionTitle
import org.wanderbibliothek.app.ui.components.StatusPill
import org.wanderbibliothek.app.ui.errorText

@Composable
fun ListingDetailScreen(
    viewModel: AppViewModel,
    listingId: String,
    onOpenListing: (String) -> Unit,
    onSignIn: () -> Unit,
    onDeleted: () -> Unit,
) {
    val texts = LocalTexts.current
    val lang = LocalLang.current
    val session by viewModel.session.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    var detail by remember { mutableStateOf<ListingDetail?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var reloads by remember { mutableIntStateOf(0) }
    var confirmDelete by remember { mutableStateOf(false) }
    var showListPicker by remember { mutableStateOf(false) }
    var myLists by remember { mutableStateOf<List<ReadingList>>(emptyList()) }

    LaunchedEffect(listingId, reloads) {
        loading = true
        error = null
        try {
            detail = viewModel.repo.listing(listingId)
        } catch (failure: Exception) {
            error = errorText(texts, failure)
        } finally {
            loading = false
        }
    }

    LaunchedEffect(showListPicker) {
        if (showListPicker) {
            myLists = runCatching { viewModel.repo.myLists() }.getOrDefault(emptyList())
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text(texts["deleteListing"]) },
            text = { Text(texts["deleteListingConfirm"]) },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    scope.launch {
                        busy = true
                        try {
                            viewModel.repo.removeListing(listingId)
                            notice = texts["statusRemoved"]
                            detail = null
                            onDeleted()
                        } catch (failure: Exception) {
                            notice = errorText(texts, failure)
                        } finally {
                            busy = false
                        }
                    }
                }) { Text(texts["delete"]) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) { Text(texts["cancel"]) }
            },
        )
    }

    if (showListPicker) {
        AlertDialog(
            onDismissRequest = { showListPicker = false },
            title = { Text(texts["listPickerTitle"]) },
            text = {
                if (myLists.isEmpty()) {
                    Text(texts["noLists"])
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        myLists.forEach { list ->
                            TextButton(
                                onClick = {
                                    showListPicker = false
                                    scope.launch {
                                        try {
                                            viewModel.repo.addBookToList(list.id, detail?.listing?.bookId.orEmpty())
                                            notice = texts["addedToList"]
                                        } catch (failure: Exception) {
                                            notice = errorText(texts, failure)
                                        }
                                    }
                                },
                            ) { Text(list.title) }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showListPicker = false }) { Text(texts["close"]) }
            },
        )
    }

    when {
        loading -> LoadingBox(texts, Modifier.fillMaxSize())
        error != null -> ErrorBox(
            message = error.orEmpty(),
            retry = texts["retry"],
            onRetry = { reloads += 1 },
            modifier = Modifier.padding(16.dp),
        )
        detail == null -> EmptyBox(texts["notFound"], Modifier.fillMaxSize())
        else -> {
            val listing = detail!!.listing
            val signedIn = session is SessionState.SignedIn
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        RemoteCover(
                            url = listing.coverUrl,
                            title = listing.title,
                            author = listing.author,
                            modifier = Modifier.width(120.dp).height(180.dp),
                        )
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Text(
                                text = listing.title,
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = texts.format("byAuthor", listing.author),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                StatusPill(listing.status, texts)
                                Pill(Labels.of(listing.condition, lang))
                            }
                            Text(
                                text = texts.format("owner", listing.ownerName),
                                style = MaterialTheme.typography.bodySmall,
                            )
                            Text(
                                text = listing.city,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }

                notice?.let { item { Notice(it) } }

                if (listing.isMine) {
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            SectionTitle(texts["status"])
                            ChoiceChips(
                                options = listOf(
                                    "available" to texts["statusAvailable"],
                                    "paused" to texts["statusPaused"],
                                    "given" to texts["statusGiven"],
                                ),
                                selected = listing.status,
                                onSelect = { status ->
                                    scope.launch {
                                        busy = true
                                        try {
                                            viewModel.repo.setListingStatus(listing.id, status)
                                            reloads += 1
                                            notice = texts["save"]
                                        } catch (failure: Exception) {
                                            notice = errorText(texts, failure)
                                        } finally {
                                            busy = false
                                        }
                                    }
                                },
                            )
                            SecondaryButton(
                                text = texts["deleteListing"],
                                enabled = !busy,
                                onClick = { confirmDelete = true },
                            )
                        }
                    }
                } else {
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            ActionButton(
                                text = if (listing.myRequestStatus == null) {
                                    texts["requestBook"]
                                } else {
                                    texts["requested"]
                                },
                                enabled = listing.myRequestStatus == null && listing.status == "available" && !busy,
                                loading = busy,
                                onClick = {
                                    if (!signedIn) {
                                        onSignIn()
                                        return@ActionButton
                                    }
                                    scope.launch {
                                        busy = true
                                        try {
                                            viewModel.repo.requestListing(listing.id)
                                            notice = texts["requestSent"]
                                            reloads += 1
                                        } catch (failure: Exception) {
                                            notice = errorText(texts, failure)
                                        } finally {
                                            busy = false
                                        }
                                    }
                                },
                            )
                            SecondaryButton(
                                text = if (listing.isFavorite) texts["removeSaved"] else texts["saveBook"],
                                enabled = signedIn && !busy,
                                onClick = {
                                    if (!signedIn) {
                                        onSignIn()
                                        return@SecondaryButton
                                    }
                                    scope.launch {
                                        busy = true
                                        try {
                                            viewModel.repo.setFavorite(listing.id, !listing.isFavorite)
                                            reloads += 1
                                        } catch (failure: Exception) {
                                            notice = errorText(texts, failure)
                                        } finally {
                                            busy = false
                                        }
                                    }
                                },
                            )
                            SecondaryButton(
                                text = texts["addToList"],
                                enabled = signedIn,
                                onClick = {
                                    if (!signedIn) onSignIn() else showListPicker = true
                                },
                            )
                        }
                    }
                }

                item {
                    Column {
                        SectionTitle(texts["details"])
                        MetaRow(texts["category"], Labels.of(listing.category, lang))
                        MetaRow(texts["language"], Labels.of(listing.language, lang))
                        MetaRow(texts["condition"], Labels.of(listing.condition, lang))
                        MetaRow(texts["city"], listing.city)
                        MetaRow(texts["publisher"], listing.publisher.orEmpty())
                        MetaRow(texts["year"], listing.year.orEmpty())
                        MetaRow(texts["series"], listing.series.orEmpty())
                        MetaRow(texts["isbn"], listing.isbn.orEmpty())
                    }
                }

                if (listing.tags.isNotEmpty()) {
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            listing.tags.forEach { tag -> Pill(Labels.of(tag, lang)) }
                        }
                    }
                }

                if (listing.notes.isNotBlank()) {
                    item {
                        Column {
                            SectionTitle(texts["notes"])
                            Text(listing.notes, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }

                if (detail!!.similar.isNotEmpty()) {
                    item { SectionTitle(texts["similar"]) }
                    items(detail!!.similar, key = { it.id }) { similar ->
                        ListingCard(
                            listing = similar,
                            texts = texts,
                            lang = lang,
                            onClick = { onOpenListing(similar.id) },
                        )
                    }
                }
                item { Spacer(Modifier.height(8.dp)) }
            }
        }
    }
}
