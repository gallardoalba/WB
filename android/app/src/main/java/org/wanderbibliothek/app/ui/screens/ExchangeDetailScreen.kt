package org.wanderbibliothek.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.wanderbibliothek.app.data.DecryptedMessage
import org.wanderbibliothek.app.data.KeyEntry
import org.wanderbibliothek.app.data.Exchange
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.Fmt
import org.wanderbibliothek.app.ui.LocalLang
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.SessionState
import org.wanderbibliothek.app.ui.components.ActionButton
import org.wanderbibliothek.app.ui.components.Bubble
import org.wanderbibliothek.app.ui.components.ChoiceChips
import org.wanderbibliothek.app.ui.components.EmptyBox
import org.wanderbibliothek.app.ui.components.ErrorBox
import org.wanderbibliothek.app.ui.components.FormField
import org.wanderbibliothek.app.ui.components.LoadingBox
import org.wanderbibliothek.app.ui.components.MetaRow
import org.wanderbibliothek.app.ui.components.Notice
import org.wanderbibliothek.app.ui.components.RemoteCover
import org.wanderbibliothek.app.ui.components.SecondaryButton
import org.wanderbibliothek.app.ui.components.SectionTitle
import org.wanderbibliothek.app.ui.components.StatusPill
import org.wanderbibliothek.app.ui.errorText

@Composable
fun ExchangeDetailScreen(
    viewModel: AppViewModel,
    exchangeId: String,
    session: SessionState,
) {
    val texts = LocalTexts.current
    val lang = LocalLang.current
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val listState = rememberLazyListState()
    val user = (session as? SessionState.SignedIn)?.user

    var exchange by remember { mutableStateOf<Exchange?>(null) }
    var messages by remember { mutableStateOf<List<DecryptedMessage>>(emptyList()) }
    var peerKeys by remember { mutableStateOf<List<KeyEntry>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var reloads by remember { mutableIntStateOf(0) }
    var draft by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }

    // Datos del envío (solo quien recibe los rellena).
    var shipKind by rememberSaveable { mutableStateOf("packstation") }
    var postNumber by rememberSaveable { mutableStateOf("") }
    var station by rememberSaveable { mutableStateOf("") }
    var street by rememberSaveable { mutableStateOf("") }
    var postalCode by rememberSaveable { mutableStateOf("") }
    var shipCity by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(exchangeId, reloads) {
        // El giro solo la primera vez: al recargar o enviar, la lista se queda
        // en pantalla en vez de desaparecer bajo un indicador.
        if (exchange == null) loading = true
        error = null
        try {
            val current = viewModel.repo.exchange(exchangeId)
            exchange = current
            current.shipping?.let { shipping ->
                shipKind = shipping.kind
                postNumber = shipping.postNumber
                station = shipping.station
                street = shipping.street
                postalCode = shipping.postalCode
                shipCity = shipping.city
            }
            val page = viewModel.repo.messages(exchangeId)
            peerKeys = page.keys.peerKeys
            messages = viewModel.repo.decrypt(exchangeId, page, user?.id.orEmpty())
            viewModel.repo.markExchangeRead(exchangeId)
        } catch (failure: Exception) {
            // Sin nada en pantalla el fallo es la vista; con datos, un aviso.
            val text = errorText(texts, failure)
            if (exchange == null) error = text else notice = text
        } finally {
            loading = false
        }
    }

    LaunchedEffect(messages.size) {
        if (messages.isEmpty()) return@LaunchedEffect
        // Hay que esperar al primer diseño: antes de él no se sabe cuántos
        // elementos hay (cabecera incluida) y el índice quedaría corto.
        withFrameNanos { }
        listState.animateScrollToItem((listState.layoutInfo.totalItemsCount - 1).coerceAtLeast(0))
    }

    fun changeStatus(status: String) {
        scope.launch {
            busy = true
            notice = null
            try {
                viewModel.repo.updateExchange(exchangeId, status)
                reloads += 1
            } catch (failure: Exception) {
                notice = errorText(texts, failure)
            } finally {
                busy = false
            }
        }
    }

    fun send() {
        val text = draft.trim()
        val keys = peerKeys
        if (text.isEmpty() || keys.isEmpty() || user == null) return
        scope.launch {
            busy = true
            try {
                viewModel.repo.sendMessage(exchangeId, text, user.id, keys)
                draft = ""
                reloads += 1
            } catch (failure: Exception) {
                notice = errorText(texts, failure)
            } finally {
                busy = false
            }
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
        exchange == null -> EmptyBox(texts["notFound"], Modifier.fillMaxSize())
        else -> {
            val current = exchange!!
            Column(Modifier.fillMaxSize().imePadding()) {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    state = listState,
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            RemoteCover(
                                url = current.coverUrl,
                                title = current.title,
                                author = current.author,
                                modifier = Modifier.width(84.dp).height(126.dp),
                            )
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(5.dp),
                            ) {
                                Text(
                                    text = current.title,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text(current.author, style = MaterialTheme.typography.bodySmall)
                                StatusPill(current.status, texts)
                                Text(
                                    text = current.peer.name,
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                Text(
                                    text = if (current.role == "requester") {
                                        texts["youRequest"]
                                    } else {
                                        texts["youOffer"]
                                    },
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }

                    notice?.let { item { Notice(it) } }

                    if (current.status == "pending") {
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (current.role == "owner") {
                                    ActionButton(
                                        text = texts["accept"],
                                        enabled = !busy,
                                        modifier = Modifier.weight(1f),
                                        onClick = { changeStatus("accepted") },
                                    )
                                    SecondaryButton(
                                        text = texts["decline"],
                                        enabled = !busy,
                                        modifier = Modifier.weight(1f),
                                        onClick = { changeStatus("declined") },
                                    )
                                } else {
                                    SecondaryButton(
                                        text = texts["cancelRequest"],
                                        enabled = !busy,
                                        onClick = { changeStatus("cancelled") },
                                    )
                                }
                            }
                        }
                    }

                    if (current.status == "accepted") {
                        item {
                            SectionTitle(texts["method"])
                            ChoiceChips(
                                options = listOf(
                                    "in_person" to texts["methodInPerson"],
                                    "post" to texts["methodPost"],
                                ),
                                selected = current.method,
                                onSelect = { method ->
                                    scope.launch {
                                        busy = true
                                        try {
                                            viewModel.repo.setHandoverMethod(current.id, method)
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

                        item {
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                if (current.role == "owner") {
                                    SecondaryButton(
                                        text = texts["markCompleted"],
                                        enabled = !busy && !current.confirmedByMe,
                                        onClick = { changeStatus("completed") },
                                    )
                                }
                                if (current.role == "requester" && !current.confirmedByMe) {
                                    FormField(
                                        value = code,
                                        onValueChange = { code = it },
                                        label = texts["enterCode"],
                                        keyboardType = KeyboardType.Number,
                                    )
                                    ActionButton(
                                        text = texts["confirmReceipt"],
                                        enabled = !busy && code.length == 6,
                                        onClick = {
                                            scope.launch {
                                                busy = true
                                                try {
                                                    viewModel.repo.verifyHandover(current.id, code)
                                                    code = ""
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
                    }

                    if (current.handoverCode != null) {
                        item {
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                SectionTitle(texts["handoverCode"])
                                Text(
                                    text = current.handoverCode,
                                    style = MaterialTheme.typography.headlineMedium,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                                SecondaryButton(
                                    text = texts["copyCode"],
                                    onClick = {
                                        clipboard.setText(AnnotatedString(current.handoverCode))
                                        notice = texts["codeCopied"]
                                    },
                                )
                            }
                        }
                    }

                    if (
                        current.status == "accepted" &&
                        current.role == "requester" &&
                        current.method == "post"
                    ) {
                        item {
                            SectionTitle(texts["shipping"])
                            ChoiceChips(
                                options = listOf(
                                    "packstation" to texts["packstation"],
                                    "address" to texts["address"],
                                ),
                                selected = shipKind,
                                onSelect = { shipKind = it },
                            )
                            if (shipKind == "packstation") {
                                FormField(postNumber, { postNumber = it }, texts["postNumber"])
                                FormField(station, { station = it }, texts["station"])
                            } else {
                                FormField(street, { street = it }, texts["street"])
                            }
                            FormField(postalCode, { postalCode = it }, texts["postalCode"])
                            FormField(shipCity, { shipCity = it }, texts["city"])
                            SecondaryButton(
                                text = texts["saveShipping"],
                                enabled = !busy && postalCode.length == 5 && shipCity.isNotBlank(),
                                onClick = {
                                    scope.launch {
                                        busy = true
                                        try {
                                            viewModel.repo.saveShipping(
                                                id = current.id,
                                                kind = shipKind,
                                                postNumber = postNumber,
                                                station = station,
                                                street = street,
                                                postalCode = postalCode,
                                                city = shipCity,
                                            )
                                            notice = texts["shippingSaved"]
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

                    item {
                        SectionTitle(texts["messages"])
                        if (peerKeys.isEmpty()) {
                            Notice(texts["encryptionUnavailable"], isError = true)
                        } else {
                            Text(
                                text = texts["encryptionNote"],
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    if (messages.isEmpty()) {
                        item { EmptyBox(texts["noMessages"]) }
                    } else {
                        items(messages, key = { it.message.id }) { item ->
                            Bubble(
                                text = item.text,
                                isMine = item.message.isMine,
                                author = item.message.senderName,
                                whenText = Fmt.relative(item.message.createdAt, lang),
                                unreadableText = texts["encryptionUnavailable"],
                            )
                        }
                    }

                    if (current.shipping != null && current.role == "owner") {
                        item {
                            SectionTitle(texts["shipping"])
                            MetaRow(texts["station"], current.shipping.station)
                            MetaRow(texts["postNumber"], current.shipping.postNumber)
                            MetaRow(texts["street"], current.shipping.street)
                            MetaRow(texts["postalCode"], current.shipping.postalCode)
                            MetaRow(texts["city"], current.shipping.city)
                        }
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = draft,
                        onValueChange = { draft = it },
                        modifier = Modifier.weight(1f),
                        placeholder = { Text(texts["writeMessage"]) },
                        maxLines = 4,
                    )
                    IconButton(
                        onClick = { send() },
                        enabled = draft.isNotBlank() && peerKeys.isNotEmpty() && !busy,
                    ) {
                        Icon(Icons.AutoMirrored.Filled.Send, contentDescription = texts["send"])
                    }
                }
            }
        }
    }
}
