package org.wanderbibliothek.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.wanderbibliothek.app.data.Listing
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.LocalLang
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.SessionState
import org.wanderbibliothek.app.ui.components.ActionButton
import org.wanderbibliothek.app.ui.components.ChoiceChips
import org.wanderbibliothek.app.ui.components.EmptyBox
import org.wanderbibliothek.app.ui.components.ErrorBox
import org.wanderbibliothek.app.ui.components.ListingCard
import org.wanderbibliothek.app.ui.components.LoadingBox
import org.wanderbibliothek.app.ui.components.SecondaryButton
import org.wanderbibliothek.app.ui.errorText

@Composable
fun ShelfScreen(
    viewModel: AppViewModel,
    session: SessionState,
    onOpenListing: (String) -> Unit,
    onSignIn: () -> Unit,
    onOffer: () -> Unit,
) {
    val texts = LocalTexts.current
    val lang = LocalLang.current
    val scope = rememberCoroutineScope()

    if (session !is SessionState.SignedIn) {
        SignInPrompt(texts, text = texts["signInToSee"], onSignIn = onSignIn)
        return
    }

    var filter by remember { mutableStateOf("mine") }
    var items by remember { mutableStateOf<List<Listing>>(emptyList()) }
    var page by remember { mutableIntStateOf(1) }
    var hasMore by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var pageError by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var reloads by remember { mutableIntStateOf(0) }

    LaunchedEffect(filter, reloads) {
        loading = true
        error = null
        pageError = null
        try {
            val result = viewModel.repo.shelf(filter, 1)
            items = result.items
            page = 1
            hasMore = result.hasMore
        } catch (failure: Exception) {
            error = errorText(texts, failure)
        } finally {
            loading = false
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                ChoiceChips(
                    options = listOf(
                        "mine" to texts["myListings"],
                        "saved" to texts["savedListings"],
                    ),
                    selected = filter,
                    onSelect = { filter = it },
                )
            }
        }
        item {
            ActionButton(text = texts["offerTitle"], onClick = onOffer)
        }
        when {
            loading -> item { LoadingBox(texts) }
            error != null -> item {
                ErrorBox(
                    message = error.orEmpty(),
                    retry = texts["retry"],
                    onRetry = { reloads += 1 },
                )
            }
            items.isEmpty() -> item { EmptyBox(texts["emptyShelf"]) }
            else -> {
                items(items, key = { it.id }) { listing ->
                    ListingCard(
                        listing = listing,
                        texts = texts,
                        lang = lang,
                        onClick = { onOpenListing(listing.id) },
                    )
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
                                        val next = viewModel.repo.shelf(filter, page + 1)
                                        items = items + next.items
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
    }
}

@Composable
fun SignInPrompt(texts: org.wanderbibliothek.app.ui.Texts, text: String, onSignIn: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(text, style = MaterialTheme.typography.bodyLarge)
        ActionButton(text = texts["signIn"], onClick = onSignIn)
    }
}
