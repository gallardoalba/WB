package org.wanderbibliothek.app.ui.screens

import android.graphics.Color
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.launch
import org.wanderbibliothek.app.data.DEFAULT_SERVER_URL
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.components.ActionButton
import org.wanderbibliothek.app.ui.components.FormField
import org.wanderbibliothek.app.ui.components.Notice
import org.wanderbibliothek.app.ui.errorText

@Composable
fun RegisterScreen(
    viewModel: AppViewModel,
    onRegistered: () -> Unit,
    onSignIn: () -> Unit,
) {
    val texts = LocalTexts.current
    val scope = rememberCoroutineScope()

    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var city by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var repeat by rememberSaveable { mutableStateOf("") }
    var ageConfirmed by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // Token de Turnstile, que llega del WebView de `/verificacion`.
    // `captchaState`: "unknown" = la página aún no ha contestado,
    // "required" = hay que resolver el widget, "off" = servidor sin Turnstile.
    var captchaToken by rememberSaveable { mutableStateOf("") }
    var captchaState by rememberSaveable { mutableStateOf("unknown") }
    val serverUrl = (viewModel.settings.value?.serverUrl ?: DEFAULT_SERVER_URL).trimEnd('/')

    fun submit() {
        when {
            name.trim().length < 2 || email.isBlank() || city.isBlank() -> {
                error = texts["requiredField"]
                return
            }
            password.length < 10 -> {
                error = texts["passwordMin"]
                return
            }
            password != repeat -> {
                error = texts["passwordMismatch"]
                return
            }
            !ageConfirmed -> {
                error = texts["ageConfirm"]
                return
            }
            captchaState == "required" && captchaToken.isBlank() -> {
                error = texts["captchaPending"]
                return
            }
        }
        scope.launch {
            busy = true
            error = null
            try {
                viewModel.signUp(
                    name, email, city, password, ageConfirmed,
                    captchaToken.takeIf { it.isNotBlank() },
                )
                onRegistered()
            } catch (failure: Exception) {
                error = errorText(texts, failure)
            } finally {
                busy = false
            }
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(texts["registerTitle"], style = MaterialTheme.typography.headlineSmall)
        Text(
            text = texts["registerSubtitle"],
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        error?.let { Notice(it, isError = true) }

        FormField(name, { name = it }, texts["name"], imeAction = ImeAction.Next)
        FormField(
            value = email,
            onValueChange = { email = it },
            label = texts["email"],
            imeAction = ImeAction.Next,
            keyboardType = KeyboardType.Email,
        )
        FormField(city, { city = it }, texts["city"], imeAction = ImeAction.Next)
        FormField(
            value = password,
            onValueChange = { password = it },
            label = texts["password"],
            imeAction = ImeAction.Next,
            password = true,
            supportingText = texts["passwordMin"],
        )
        FormField(
            value = repeat,
            onValueChange = { repeat = it },
            label = texts["passwordRepeat"],
            password = true,
            imeAction = ImeAction.Done,
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = ageConfirmed, onCheckedChange = { ageConfirmed = it })
            Text(texts["ageConfirm"], style = MaterialTheme.typography.bodySmall)
        }
        // Turnstile se pinta en un WebView de la página `/verificacion` del
        // servidor: Cloudflare valida el dominio y un contenido local no lo
        // tiene. Si el servidor no usa Turnstile, la página lo dice y esta
        // casilla desaparece.
        if (captchaState != "off") {
            Text(
                text = texts["captchaHint"],
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            TurnstileWebView(
                serverUrl = serverUrl,
                onRequired = { captchaState = if (it) "required" else "off" },
                onToken = { captchaToken = it },
            )
        }
        ActionButton(text = texts["register"], loading = busy, onClick = { submit() })
        TextButton(onClick = onSignIn) { Text(texts["haveAccount"]) }
    }
}

/**
 * Widget de Turnstile dentro de un WebView.
 *
 * La página `$serverUrl/verificacion` llama a la interfaz `WbTurnstile`:
 * `required(false)` cuando el servidor no tiene Turnstile configurado y
 * `token(...)` (vacío al caducar) con el token que hay que mandar al registrar.
 * Las llamadas llegan en un hilo de fondo, así que se publican en el hilo
 * principal antes de tocar el estado de Compose.
 */
@Composable
private fun TurnstileWebView(
    serverUrl: String,
    onRequired: (Boolean) -> Unit,
    onToken: (String) -> Unit,
) {
    AndroidView(
        modifier = Modifier.fillMaxWidth().height(84.dp),
        factory = { context ->
            val webView = WebView(context)
            webView.setBackgroundColor(Color.TRANSPARENT)
            webView.settings.javaScriptEnabled = true
            // El widget no necesita nada de esto y cuanto menos se abra, mejor.
            webView.settings.domStorageEnabled = false
            webView.settings.allowFileAccess = false
            webView.settings.allowContentAccess = false
            webView.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    val url = request.url.toString()
                    // Solo la página del servidor y el propio widget: cualquier
                    // otro destino se descarta.
                    return !(url.startsWith(serverUrl) ||
                        url.startsWith("https://challenges.cloudflare.com") ||
                        url.startsWith("about:"))
                }
            }
            webView.addJavascriptInterface(
                object {
                    @JavascriptInterface
                    fun required(value: Boolean) {
                        webView.post { onRequired(value) }
                    }

                    @JavascriptInterface
                    fun token(value: String) {
                        webView.post { onToken(value) }
                    }
                },
                "WbTurnstile",
            )
            webView.loadUrl("$serverUrl/verificacion")
            webView
        },
        onRelease = { webView -> webView.destroy() },
    )
}
