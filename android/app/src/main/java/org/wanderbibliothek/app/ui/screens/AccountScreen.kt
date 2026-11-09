package org.wanderbibliothek.app.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.wanderbibliothek.app.data.DEFAULT_SERVER_URL
import org.wanderbibliothek.app.data.Languages
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.SessionState
import org.wanderbibliothek.app.ui.components.ActionButton
import org.wanderbibliothek.app.ui.components.FormField
import org.wanderbibliothek.app.ui.components.Notice
import org.wanderbibliothek.app.ui.components.SecondaryButton
import org.wanderbibliothek.app.ui.components.SectionTitle
import org.wanderbibliothek.app.ui.errorText
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun AccountScreen(
    viewModel: AppViewModel,
    session: SessionState,
    onSignIn: () -> Unit,
    onNotifications: () -> Unit,
    onLists: () -> Unit,
    onSettings: () -> Unit,
    onEditProfile: () -> Unit,
    onChangePassword: () -> Unit,
    onTwoFactor: () -> Unit,
    onDeleted: () -> Unit,
) {
    val texts = LocalTexts.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val user = (session as? SessionState.SignedIn)?.user
    if (user == null) {
        SignInPrompt(texts, text = texts["notSignedIn"], onSignIn = onSignIn)
        return
    }

    val serverUrl = (viewModel.settings.value?.serverUrl ?: DEFAULT_SERVER_URL).trimEnd('/')
    var notice by rememberSaveable { mutableStateOf<String?>(null) }
    var isError by rememberSaveable { mutableStateOf(false) }
    var exporting by rememberSaveable { mutableStateOf(false) }
    var askDelete by rememberSaveable { mutableStateOf(false) }
    // La contraseña de confirmación no se guarda en disco.
    var password by remember { mutableStateOf("") }
    var deleting by rememberSaveable { mutableStateOf(false) }

    fun openPage(path: String) {
        // La web publica cada idioma en su URL (`/es/…`, `/en/…`) y el alemán
        // sin prefijo: sin esto la app abriría siempre la versión alemana.
        val prefix = Languages.fromSystem().let { if (it == "de") "" else "/$it" }
        runCatching {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$serverUrl$prefix$path")))
        }
    }

    /** Guarda la exportación en la caché y abre el diálogo de compartir. */
    fun shareExport() {
        scope.launch {
            exporting = true
            notice = null
            try {
                val json = withContext(Dispatchers.IO) { viewModel.repo.exportData() }
                val stamp = SimpleDateFormat("yyyyMMdd-HHmm", Locale.ROOT).format(Date())
                val dir = File(context.cacheDir, "export").apply { mkdirs() }
                // Una exportación lleva perfil e historial en claro: la de la vez
                // anterior no tiene por qué seguir en la caché.
                withContext(Dispatchers.IO) { dir.listFiles()?.forEach { it.delete() } }
                val file = File(dir, "wanderbibliothek-$stamp.json")
                withContext(Dispatchers.IO) { file.writeText(json) }
                val uri = FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.files",
                    file,
                )
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "application/json"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                context.startActivity(Intent.createChooser(send, texts["exportData"]))
                notice = texts["exportPrepared"]
                isError = false
            } catch (failure: Exception) {
                notice = errorText(texts, failure)
                isError = true
            } finally {
                exporting = false
            }
        }
    }

    if (askDelete) {
        AlertDialog(
            onDismissRequest = { if (!deleting) askDelete = false },
            title = { Text(texts["deleteAccount"]) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(texts["deleteAccountHint"], style = MaterialTheme.typography.bodyMedium)
                    FormField(
                        value = password,
                        onValueChange = { password = it },
                        label = texts["password"],
                        password = true,
                        enabled = !deleting,
                    )
                }
            },
            confirmButton = {
                TextButton(
                    enabled = password.isNotEmpty() && !deleting,
                    onClick = {
                        scope.launch {
                            deleting = true
                            try {
                                viewModel.deleteAccount(password)
                                askDelete = false
                                password = ""
                                onDeleted()
                            } catch (failure: Exception) {
                                notice = errorText(texts, failure)
                                isError = true
                                askDelete = false
                            } finally {
                                deleting = false
                            }
                        }
                    },
                ) { Text(texts["delete"]) }
            },
            dismissButton = {
                TextButton(enabled = !deleting, onClick = { askDelete = false }) {
                    Text(texts["cancel"])
                }
            },
        )
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = initialsOf(user.name),
                        style = MaterialTheme.typography.headlineMedium,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(end = 12.dp),
                    )
                    Column {
                        Text(
                            text = user.name,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = user.city,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Text(user.email, style = MaterialTheme.typography.bodySmall)
                if (user.bio.isNotBlank()) {
                    Text(user.bio, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }

        if (!user.emailVerified) {
            Notice(texts["verifyEmail"], isError = true)
        }
        notice?.let { Notice(it, isError = isError) }

        SectionTitle(texts["myProfile"])
        SecondaryButton(text = texts["editProfile"], onClick = onEditProfile)
        SecondaryButton(text = texts["notifications"], onClick = onNotifications)
        SecondaryButton(text = texts["readingLists"], onClick = onLists)

        SectionTitle(texts["security"])
        SecondaryButton(text = texts["twoFactor"], onClick = onTwoFactor)
        SecondaryButton(text = texts["changePassword"], onClick = onChangePassword)

        SectionTitle(texts["exportData"])
        Text(
            text = texts["exportHint"],
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SecondaryButton(
            text = texts["exportData"],
            onClick = { shareExport() },
            enabled = !exporting,
            loading = exporting,
        )

        SectionTitle(texts["legal"])
        SecondaryButton(text = texts["privacy"], onClick = { openPage("$serverUrl/privacidad") })
        SecondaryButton(
            text = texts["legalNotice"],
            onClick = { openPage("$serverUrl/aviso-legal") },
        )
        SecondaryButton(
            text = texts["documentation"],
            onClick = { openPage("$serverUrl/documentacion") },
        )

        SectionTitle(texts["settings"])
        SecondaryButton(text = texts["settings"], onClick = onSettings)

        ActionButton(
            text = texts["signOut"],
            onClick = { viewModel.signOut() },
        )

        SectionTitle(texts["dangerZone"])
        SecondaryButton(
            text = texts["deleteAccount"],
            onClick = { askDelete = true },
        )
    }
}

private fun initialsOf(name: String): String =
    name.split(" ")
        .filter { it.isNotBlank() }
        .take(2)
        .joinToString("") { it.take(1).uppercase() }
        .ifEmpty { "?" }
