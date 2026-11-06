package org.wanderbibliothek.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
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
import kotlinx.coroutines.launch
import org.wanderbibliothek.app.data.ReadingList
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.SessionState
import org.wanderbibliothek.app.ui.components.ActionButton
import org.wanderbibliothek.app.ui.components.ChoiceChips
import org.wanderbibliothek.app.ui.components.EmptyBox
import org.wanderbibliothek.app.ui.components.ErrorBox
import org.wanderbibliothek.app.ui.components.FormField
import org.wanderbibliothek.app.ui.components.LoadingBox
import org.wanderbibliothek.app.ui.components.Notice
import org.wanderbibliothek.app.ui.components.Pill
import org.wanderbibliothek.app.ui.components.SecondaryButton
import org.wanderbibliothek.app.ui.errorText

@Composable
fun ListsScreen(
    viewModel: AppViewModel,
    session: SessionState,
    onOpenList: (String) -> Unit,
    onSignIn: () -> Unit,
) {
    val texts = LocalTexts.current
    val scope = rememberCoroutineScope()

    if (session !is SessionState.SignedIn) {
        SignInPrompt(texts, text = texts["signInToSee"], onSignIn = onSignIn)
        return
    }

    var tab by remember { mutableStateOf("public") }
    var items by remember { mutableStateOf<List<ReadingList>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var reloads by remember { mutableIntStateOf(0) }
    var showCreate by remember { mutableStateOf(false) }
    var newTitle by remember { mutableStateOf("") }
    var newDescription by remember { mutableStateOf("") }
    var showOwner by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(tab, reloads) {
        loading = true
        error = null
        try {
            items = if (tab == "mine") viewModel.repo.myLists() else viewModel.repo.publicLists()
        } catch (failure: Exception) {
            error = errorText(texts, failure)
        } finally {
            loading = false
        }
    }

    if (showCreate) {
        AlertDialog(
            onDismissRequest = { showCreate = false },
            title = { Text(texts["createList"]) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FormField(newTitle, { newTitle = it }, texts["listTitleLabel"])
                    FormField(newDescription, { newDescription = it }, texts["listDescription"])
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = showOwner, onCheckedChange = { showOwner = it })
                        Text(texts["showOwner"], style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = newTitle.trim().length >= 3 && !busy,
                    onClick = {
                        scope.launch {
                            busy = true
                            try {
                                viewModel.repo.createList(newTitle, newDescription, showOwner)
                                showCreate = false
                                newTitle = ""
                                newDescription = ""
                                showOwner = false
                                tab = "mine"
                                reloads += 1
                                notice = texts["listCreated"]
                            } catch (failure: Exception) {
                                notice = errorText(texts, failure)
                            } finally {
                                busy = false
                            }
                        }
                    },
                ) { Text(texts["save"]) }
            },
            dismissButton = {
                TextButton(onClick = { showCreate = false }) { Text(texts["cancel"]) }
            },
        )
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Text(
                text = texts["listsSubtitle"],
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        item {
            ChoiceChips(
                options = listOf(
                    "public" to texts["publicLists"],
                    "mine" to texts["myLists"],
                ),
                selected = tab,
                onSelect = { tab = it },
            )
        }
        item {
            ActionButton(text = texts["createList"], onClick = { showCreate = true })
        }
        notice?.let { item { Notice(it) } }
        when {
            loading -> item { LoadingBox(texts) }
            error != null -> item {
                ErrorBox(
                    message = error.orEmpty(),
                    retry = texts["retry"],
                    onRetry = { reloads += 1 },
                )
            }
            items.isEmpty() -> item { EmptyBox(texts["emptyLists"]) }
            else -> items(items, key = { it.id }) { list ->
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    onClick = { onOpenList(list.id) },
                ) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = list.title,
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                        )
                        if (list.description.isNotBlank()) {
                            Text(list.description, style = MaterialTheme.typography.bodySmall)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Pill(texts.format("booksInList", list.items))
                            if (list.showOwner || list.isMine) {
                                Pill(texts.format("listBy", list.ownerName))
                            } else {
                                Pill(texts["anonymousOwner"])
                            }
                        }
                    }
                }
            }
        }
    }
}
