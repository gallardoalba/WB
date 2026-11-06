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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.wanderbibliothek.app.data.ReadingListDetail
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.components.EmptyBox
import org.wanderbibliothek.app.ui.components.ErrorBox
import org.wanderbibliothek.app.ui.components.LoadingBox
import org.wanderbibliothek.app.ui.components.Pill
import org.wanderbibliothek.app.ui.components.RemoteCover
import org.wanderbibliothek.app.ui.components.SecondaryButton
import org.wanderbibliothek.app.ui.errorText

@Composable
fun ListDetailScreen(viewModel: AppViewModel, listId: String, onDeleted: () -> Unit) {
    val texts = LocalTexts.current
    val scope = rememberCoroutineScope()

    var detail by remember { mutableStateOf<ReadingListDetail?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var deleted by remember { mutableStateOf(false) }

    LaunchedEffect(listId) {
        loading = true
        error = null
        try {
            detail = viewModel.repo.listDetail(listId)
        } catch (failure: Exception) {
            error = errorText(texts, failure)
        } finally {
            loading = false
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text(texts["deleteList"]) },
            text = { Text(texts["deleteListConfirm"]) },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    scope.launch {
                        try {
                            viewModel.repo.deleteList(listId)
                            deleted = true
                            onDeleted()
                        } catch (failure: Exception) {
                            error = errorText(texts, failure)
                        }
                    }
                }) { Text(texts["delete"]) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) { Text(texts["cancel"]) }
            },
        )
    }

    when {
        deleted -> EmptyBox(texts["deleteList"], Modifier.fillMaxSize())
        loading -> LoadingBox(texts, Modifier.fillMaxSize())
        error != null -> ErrorBox(
            message = error.orEmpty(),
            retry = texts["retry"],
            modifier = Modifier.padding(16.dp),
        )
        detail == null -> EmptyBox(texts["notFound"], Modifier.fillMaxSize())
        else -> {
            val list = detail!!
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = list.list.title,
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.SemiBold,
                        )
                        if (list.list.description.isNotBlank()) {
                            Text(list.list.description, style = MaterialTheme.typography.bodyMedium)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Pill(texts.format("booksInList", list.books.size))
                            Pill(
                                if (list.list.showOwner || list.list.isMine) {
                                    texts.format("listBy", list.list.ownerName)
                                } else {
                                    texts["anonymousOwner"]
                                },
                            )
                        }
                    }
                }
                if (list.list.isMine) {
                    item {
                        SecondaryButton(
                            text = texts["deleteList"],
                            onClick = { confirmDelete = true },
                        )
                    }
                }
                if (list.books.isEmpty()) {
                    item { EmptyBox(texts["noBooksInList"]) }
                } else {
                    items(list.books, key = { it.bookId }) { book ->
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Row(
                                modifier = Modifier.padding(10.dp),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                RemoteCover(
                                    url = book.coverUrl,
                                    title = book.title,
                                    author = book.author,
                                    modifier = Modifier.width(56.dp).height(84.dp),
                                )
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        text = book.title,
                                        style = MaterialTheme.typography.titleSmall,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                    Text(
                                        text = book.author,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    if (book.note.isNotBlank()) {
                                        Text(book.note, style = MaterialTheme.typography.bodySmall)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
