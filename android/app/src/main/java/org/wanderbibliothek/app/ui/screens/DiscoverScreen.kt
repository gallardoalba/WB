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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.wanderbibliothek.app.data.Catalogs
import org.wanderbibliothek.app.data.Listing
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.Fmt
import org.wanderbibliothek.app.ui.Labels
import org.wanderbibliothek.app.ui.LocalLang
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.components.ChoiceChips
import org.wanderbibliothek.app.ui.components.EmptyBox
import org.wanderbibliothek.app.ui.components.ErrorBox
import org.wanderbibliothek.app.ui.components.FormField
import org.wanderbibliothek.app.ui.components.ListingCard
import org.wanderbibliothek.app.ui.components.LoadingBox
import org.wanderbibliothek.app.ui.components.SecondaryButton
import org.wanderbibliothek.app.ui.components.SectionTitle
import org.wanderbibliothek.app.ui.errorText

@Composable
fun DiscoverScreen(
    viewModel: AppViewModel,
    onOpenListing: (String) -> Unit,
) {
    val texts = LocalTexts.current
    val lang = LocalLang.current
    val scope = rememberCoroutineScope()

    var query by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("Todos") }
    var sort by rememberSaveable { mutableStateOf("near") }
    var radius by rememberSaveable { mutableIntStateOf(0) }
    var showFilters by rememberSaveable { mutableStateOf(false) }

    var items by remember { mutableStateOf<List<Listing>>(emptyList()) }
    var total by remember { mutableIntStateOf(0) }
    var page by remember { mutableIntStateOf(1) }
    var hasMore by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var loadingMore by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var pageError by remember { mutableStateOf<String?>(null) }
    var reloads by remember { mutableIntStateOf(0) }

    LaunchedEffect(query, category, sort, radius, reloads) {
        if (reloads == 0) delay(250)
        loading = true
        error = null
        pageError = null
        try {
            val result = viewModel.repo.listings(
                query = query,
                category = category,
                sort = sort,
                radius = radius,
                page = 1,
            )
            items = result.items
            total = result.total
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
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(texts["heroTitle"], style = MaterialTheme.typography.headlineSmall)
                Text(
                    text = texts["heroSubtitle"],
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        item {
            FormField(
                value = query,
                onValueChange = { query = it },
                label = texts["searchPlaceholder"],
            )
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { showFilters = !showFilters }) {
                    Text(texts["filters"])
                }
                Spacer(Modifier.weight(1f))
                Text(
                    text = texts.format("results", Fmt.number(total, lang)),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (showFilters) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    SectionTitle(texts["category"])
                    ChoiceChips(
                        options = listOf("Todos" to texts["all"]) +
                            Catalogs.categories.map { it to Labels.of(it, lang) },
                        selected = category,
                        onSelect = { category = it },
                    )
                    SectionTitle(texts["sort"])
                    ChoiceChips(
                        options = listOf(
                            "near" to texts["sortNear"],
                            "recent" to texts["sortRecent"],
                            "title" to texts["sortTitle"],
                        ),
                        selected = sort,
                        onSelect = { sort = it },
                    )
                    SectionTitle(texts["radius"])
                    ChoiceChips(
                        options = listOf("0" to texts["radiusAny"]) +
                            listOf(5, 10, 25, 50, 100).map {
                                it.toString() to texts.format("radiusKm", it)
                            },
                        selected = radius.toString(),
                        onSelect = { radius = it.toIntOrNull() ?: 0 },
                    )
                }
            }
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
            items.isEmpty() -> item { EmptyBox(texts["noResults"]) }
            else -> {
                items(items, key = { it.id }) { listing ->
                    ListingCard(
                        listing = listing,
                        texts = texts,
                        lang = lang,
                        onClick = { onOpenListing(listing.id) },
                    )
                }
                if (hasMore) {
                    item {
                        pageError?.let { message ->
                            ErrorBox(
                                message = message,
                                retry = texts["retry"],
                                onRetry = {
                                    pageError = null
                                    loadingMore = false
                                },
                                modifier = Modifier.padding(bottom = 8.dp),
                            )
                        }
                        SecondaryButton(
                            text = texts["loadMore"],
                            enabled = !loadingMore,
                            onClick = {
                                scope.launch {
                                    loadingMore = true
                                    pageError = null
                                    try {
                                        val next = viewModel.repo.listings(
                                            query = query,
                                            category = category,
                                            sort = sort,
                                            radius = radius,
                                            page = page + 1,
                                        )
                                        items = items + next.items
                                        page += 1
                                        hasMore = next.hasMore
                                    } catch (failure: Exception) {
                                        // Solo afecta a «cargar más»: la lista ya
                                        // cargada se queda en pantalla.
                                        pageError = errorText(texts, failure)
                                    } finally {
                                        loadingMore = false
                                    }
                                }
                            },
                        )
                    }
                }
                item { Spacer(Modifier.height(8.dp)) }
            }
        }
    }
}
