package org.wanderbibliothek.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.wanderbibliothek.app.data.Catalogs
import org.wanderbibliothek.app.data.Listing
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.Fmt
import org.wanderbibliothek.app.ui.Labels
import org.wanderbibliothek.app.ui.LocalLang
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.Texts
import org.wanderbibliothek.app.ui.components.ChoiceChips
import org.wanderbibliothek.app.ui.components.EmptyBox
import org.wanderbibliothek.app.ui.components.ErrorBox
import org.wanderbibliothek.app.ui.components.FormField
import org.wanderbibliothek.app.ui.components.ListingCard
import org.wanderbibliothek.app.ui.components.LoadingBox
import org.wanderbibliothek.app.ui.components.RemoteCover
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
    val settings by viewModel.settings.collectAsStateWithLifecycle()

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
        // Siempre se espera: sin esto, a partir del primer «Reintentar»
        // (reloads > 0) cada tecla del buscador lanzaba una petición.
        delay(250)
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
            DiscoverHero(
                texts = texts,
                language = settings?.language ?: "system",
                covers = items.take(2).mapNotNull { listing ->
                    listing.coverUrl?.let { it to listing.title }
                },
                onLanguage = { chosen -> scope.launch { viewModel.setLanguage(chosen) } },
            )
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

/**
 * Portada de la app: la marca, la idea de comunidad y el idioma, todo antes de
 * buscar y sin necesidad de sesión.
 *
 * El degradado va del verde del bosque al ocre de la plataforma y las portadas
 * de los primeros ejemplares dan color real: la pantalla de inicio no decía ni
 * cómo se llamaba la app.
 */
@Composable
private fun DiscoverHero(
    texts: Texts,
    language: String,
    covers: List<Pair<String, String>>,
    onLanguage: (String) -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        color = colors.primary,
    ) {
        Box(
            modifier = Modifier
                .background(Brush.linearGradient(listOf(colors.primary, colors.tertiary)))
                .padding(18.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                // Medido con métricas reales: «Wanderbibliothek» a 28 sp en
                // serif son 288 dp y no cabe en un móvil de 360; se ajusta al
                // ancho disponible sin partirse ni recortarse con puntos.
                Text(
                    text = texts["brandName"],
                    style = MaterialTheme.typography.headlineLarge.copy(
                        fontFamily = FontFamily.Serif,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.4.sp,
                    ),
                    color = colors.onPrimary,
                    maxLines = 1,
                    softWrap = false,
                    overflow = TextOverflow.Clip,
                    autoSize = TextAutoSize.StepBased(
                        minFontSize = 20.sp,
                        maxFontSize = 30.sp,
                        stepSize = 0.5.sp,
                    ),
                    modifier = Modifier.fillMaxWidth().semantics { heading() },
                )
                Text(
                    text = texts["brandTagline"],
                    style = MaterialTheme.typography.titleSmall,
                    color = colors.onPrimary,
                )
                Text(
                    text = texts["heroSubtitle"],
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.onPrimary.copy(alpha = 0.9f),
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    ChoiceChips(
                        options = listOf(
                            "system" to texts["languageAuto"],
                            "de" to texts["german"],
                            "es" to texts["spanish"],
                        ),
                        selected = language,
                        onSelect = onLanguage,
                        modifier = Modifier.weight(1f),
                    )
                    // Portadas reales del catálogo: color sin tapar el texto.
                    covers.take(2).forEach { (url, title) ->
                        RemoteCover(
                            url = url,
                            title = title,
                            author = "",
                            modifier = Modifier.width(30.dp).height(44.dp),
                        )
                    }
                }
            }
        }
    }
}
