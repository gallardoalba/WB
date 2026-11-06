package org.wanderbibliothek.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.wanderbibliothek.app.data.AppNotification
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.Fmt
import org.wanderbibliothek.app.ui.LocalLang
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.SessionState
import org.wanderbibliothek.app.ui.components.EmptyBox
import org.wanderbibliothek.app.ui.components.ErrorBox
import org.wanderbibliothek.app.ui.components.LoadingBox
import org.wanderbibliothek.app.ui.components.Notice
import org.wanderbibliothek.app.ui.components.SecondaryButton
import org.wanderbibliothek.app.ui.errorText

/**
 * Avisos de la cuenta, con dos mejoras sobre la primera versión: cada aviso
 * lleva a su pantalla (intercambio, libro o club) y se marca como leído al
 * abrirlo, así que la lista deja de ser un callejón sin salida.
 */
@Composable
fun NotificationsScreen(
    viewModel: AppViewModel,
    session: SessionState,
    onOpen: (String) -> Unit,
) {
    val texts = LocalTexts.current
    val lang = LocalLang.current
    val scope = rememberCoroutineScope()

    var items by remember { mutableStateOf<List<AppNotification>>(emptyList()) }
    var hasMore by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var loadingMore by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var reloads by remember { mutableIntStateOf(0) }

    LaunchedEffect(session, reloads) {
        if (session !is SessionState.SignedIn) {
            loading = false
            return@LaunchedEffect
        }
        loading = true
        error = null
        try {
            val page = viewModel.repo.notifications(0)
            items = page.first
            hasMore = page.second
        } catch (failure: Exception) {
            error = errorText(texts, failure)
        } finally {
            loading = false
        }
    }

    fun open(notification: AppNotification) {
        // Marcar como leído antes de navegar: si falla, el aviso sigue ahí.
        if (notification.readAt == null) {
            scope.launch {
                runCatching { viewModel.repo.markNotificationRead(notification.id) }
                items = items.map {
                    if (it.id == notification.id) it.copy(readAt = it.readAt ?: "now") else it
                }
            }
        }
        routeFor(notification)?.let(onOpen)
    }

    Column(Modifier.fillMaxSize()) {
        SecondaryButton(
            text = texts["markAllRead"],
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            onClick = {
                scope.launch {
                    try {
                        viewModel.repo.markAllNotificationsRead()
                        reloads += 1
                    } catch (failure: Exception) {
                        notice = errorText(texts, failure)
                    }
                }
            },
        )
        notice?.let {
            Notice(it, isError = true)
        }
        when {
            loading -> LoadingBox(texts)
            error != null -> ErrorBox(
                message = error.orEmpty(),
                retry = texts["retry"],
                onRetry = { reloads += 1 },
                modifier = Modifier.padding(16.dp),
            )
            items.isEmpty() -> EmptyBox(texts["emptyNotifications"])
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(items, key = { it.id }) { notification ->
                    val unread = notification.readAt == null
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        onClick = { open(notification) },
                    ) {
                        Row(
                            Modifier.padding(12.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            if (unread) {
                                val unreadLabel = texts["unread"]
                                Surface(
                                    modifier = Modifier
                                        .size(8.dp)
                                        .semantics { contentDescription = unreadLabel },
                                    shape = CircleShape,
                                    color = MaterialTheme.colorScheme.primary,
                                ) { }
                            }
                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(
                                    text = notification.title,
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text(
                                    text = notification.body,
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                Text(
                                    text = Fmt.relative(notification.createdAt, lang),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
                if (hasMore) {
                    item {
                        SecondaryButton(
                            text = texts["loadMore"],
                            enabled = !loadingMore,
                            onClick = {
                                scope.launch {
                                    loadingMore = true
                                    try {
                                        val page = viewModel.repo.notifications(items.size)
                                        items = items + page.first
                                        hasMore = page.second
                                    } catch (failure: Exception) {
                                        notice = errorText(texts, failure)
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

/**
 * Traduce el enlace del servidor (rutas de la web) a una pantalla de la app.
 *
 * `requestId` manda: los avisos de intercambio lo traen aunque el enlace apunte
 * a la ficha del libro. Lo que no tiene equivalente (perfiles) no navega.
 */
private fun routeFor(notification: AppNotification): String? {
    notification.requestId?.let { return "exchange/$it" }
    val link = notification.link ?: return null
    Regex("^/libro/([^/#?]+)").find(link)?.groupValues?.getOrNull(1)?.let {
        return "listing/$it"
    }
    Regex("^/clubes/([^/#?]+)").find(link)?.groupValues?.getOrNull(1)?.let {
        return "club/$it"
    }
    return null
}
