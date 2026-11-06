package org.wanderbibliothek.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.wanderbibliothek.app.data.Exchange
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.Fmt
import org.wanderbibliothek.app.ui.LocalLang
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.SessionState
import org.wanderbibliothek.app.ui.components.EmptyBox
import org.wanderbibliothek.app.ui.components.ErrorBox
import org.wanderbibliothek.app.ui.components.LoadingBox
import org.wanderbibliothek.app.ui.components.RemoteCover
import org.wanderbibliothek.app.ui.components.StatusPill
import org.wanderbibliothek.app.ui.errorText

@Composable
fun ExchangesScreen(
    viewModel: AppViewModel,
    session: SessionState,
    onOpenExchange: (String) -> Unit,
    onSignIn: () -> Unit,
) {
    val texts = LocalTexts.current
    val lang = LocalLang.current

    if (session !is SessionState.SignedIn) {
        SignInPrompt(texts, text = texts["signInToSee"], onSignIn = onSignIn)
        return
    }

    var items by remember { mutableStateOf<List<Exchange>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var reloads by remember { mutableIntStateOf(0) }

    LaunchedEffect(session, reloads) {
        loading = true
        error = null
        try {
            items = viewModel.repo.exchanges()
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
        items.isEmpty() -> EmptyBox(texts["emptyExchanges"], Modifier.fillMaxSize())
        else -> LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(items, key = { it.id }) { exchange ->
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    onClick = { onOpenExchange(exchange.id) },
                ) {
                    Row(
                        modifier = Modifier.padding(10.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        RemoteCover(
                            url = exchange.coverUrl,
                            title = exchange.title,
                            author = exchange.author,
                            modifier = Modifier.width(56.dp).height(80.dp),
                        )
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(
                                text = exchange.title,
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                text = exchange.peer.name,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                StatusPill(exchange.status, texts)
                            }
                            Text(
                                text = Fmt.relative(exchange.updatedAt, lang),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            if (exchange.unreadMessages > 0) {
                                Text(
                                    text = "${exchange.unreadMessages} ${texts["unread"]}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
