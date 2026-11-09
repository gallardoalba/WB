package org.wanderbibliothek.app.ui.screens

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.wanderbibliothek.app.data.TotpSetup
import org.wanderbibliothek.app.data.TotpState
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.components.ActionButton
import org.wanderbibliothek.app.ui.components.FormField
import org.wanderbibliothek.app.ui.components.LoadingBox
import org.wanderbibliothek.app.ui.components.Notice
import org.wanderbibliothek.app.ui.errorText

/**
 * Verificación en dos pasos con una aplicación de autenticación.
 *
 * El secreto se enseña una sola vez, como PNG en `qrDataUrl` (el servidor lo
 * genera) y como texto por si la cámara no está disponible. Activar y
 * desactivar piden la contraseña: una sesión abierta no basta para cambiar el
 * segundo factor.
 */
@Composable
fun TwoFactorScreen(viewModel: AppViewModel) {
    val texts = LocalTexts.current
    val scope = rememberCoroutineScope()

    var state by remember { mutableStateOf<TotpState?>(null) }
    var setup by remember { mutableStateOf<TotpSetup?>(null) }
    // Contraseña y código de un solo uso: en memoria, no en el estado guardado.
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var busy by rememberSaveable { mutableStateOf(false) }
    var message by rememberSaveable { mutableStateOf<String?>(null) }
    var isError by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        try {
            state = viewModel.repo.totpState()
        } catch (failure: Exception) {
            message = errorText(texts, failure)
            isError = true
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        message?.let { Notice(it, isError = isError) }

        val current = state
        if (current == null) {
            LoadingBox(texts)
            return@Column
        }

        if (current.enabled) {
            Text(texts["twoFactorOn"], style = MaterialTheme.typography.bodyMedium)
            FormField(
                value = password,
                onValueChange = { password = it },
                label = texts["currentPassword"],
                password = true,
                enabled = !busy,
            )
            FormField(
                value = code,
                onValueChange = { code = it },
                label = texts["twoFactorCodeShort"],
                keyboardType = KeyboardType.Number,
                enabled = !busy,
            )
            ActionButton(
                text = texts["disable"],
                loading = busy,
                enabled = password.isNotEmpty() && code.length >= 6,
                onClick = {
                    scope.launch {
                        busy = true
                        message = null
                        try {
                            state = viewModel.repo.disableTotp(password, code)
                            password = ""
                            code = ""
                            message = texts["twoFactorDisabled"]
                            isError = false
                        } catch (failure: Exception) {
                            message = errorText(texts, failure)
                            isError = true
                        } finally {
                            busy = false
                        }
                    }
                },
            )
            return@Column
        }

        Text(
            text = if (current.pending) texts["twoFactorPending"] else texts["twoFactorOff"],
            style = MaterialTheme.typography.bodyMedium,
        )

        val pendingSetup = setup
        if (pendingSetup == null) {
            FormField(
                value = password,
                onValueChange = { password = it },
                label = texts["currentPassword"],
                password = true,
                enabled = !busy,
            )
            ActionButton(
                text = texts["enable"],
                loading = busy,
                enabled = password.isNotEmpty(),
                onClick = {
                    scope.launch {
                        busy = true
                        message = null
                        try {
                            setup = viewModel.repo.startTotp(password)
                            password = ""
                            code = ""
                        } catch (failure: Exception) {
                            message = errorText(texts, failure)
                            isError = true
                        } finally {
                            busy = false
                        }
                    }
                },
            )
            return@Column
        }

        Text(texts["twoFactorScan"], style = MaterialTheme.typography.bodyMedium)
        val qr by produceState<ImageBitmap?>(initialValue = null, key1 = pendingSetup.qrDataUrl) {
            value = withContext(Dispatchers.Default) { decodeDataUrl(pendingSetup.qrDataUrl) }
        }
        qr?.let {
            Image(
                bitmap = it,
                contentDescription = texts["twoFactorScan"],
                modifier = Modifier.size(200.dp).align(Alignment.CenterHorizontally),
            )
        }
        Text(texts["twoFactorSecret"], style = MaterialTheme.typography.labelLarge)
        SelectionContainer {
            Text(
                text = pendingSetup.secret,
                style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
            )
        }
        FormField(
            value = code,
            onValueChange = { code = it },
            label = texts["twoFactorCodeShort"],
            keyboardType = KeyboardType.Number,
            enabled = !busy,
        )
        ActionButton(
            text = texts["enable"],
            loading = busy,
            enabled = code.length >= 6,
            onClick = {
                scope.launch {
                    busy = true
                    message = null
                    try {
                        state = viewModel.repo.enableTotp(code)
                        setup = null
                        code = ""
                        message = texts["twoFactorEnabled"]
                        isError = false
                    } catch (failure: Exception) {
                        message = errorText(texts, failure)
                        isError = true
                    } finally {
                        busy = false
                    }
                }
            },
        )
    }
}

/** `data:image/png;base64,…` → mapa de bits, sin sacar el decodificado al hilo de UI. */
private fun decodeDataUrl(dataUrl: String?): ImageBitmap? {
    val payload = dataUrl?.substringAfter("base64,", "")?.takeIf { it.isNotEmpty() } ?: return null
    val bytes = runCatching { Base64.decode(payload, Base64.DEFAULT) }.getOrNull() ?: return null
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
}
