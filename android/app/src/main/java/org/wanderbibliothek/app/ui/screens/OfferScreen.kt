package org.wanderbibliothek.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.wanderbibliothek.app.data.Catalogs
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.Labels
import org.wanderbibliothek.app.ui.LocalLang
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.SessionState
import org.wanderbibliothek.app.ui.components.ActionButton
import org.wanderbibliothek.app.ui.components.ChoiceChips
import org.wanderbibliothek.app.ui.components.FormField
import org.wanderbibliothek.app.ui.components.LoadingBox
import org.wanderbibliothek.app.ui.components.MultiChoiceChips
import org.wanderbibliothek.app.ui.components.Notice
import org.wanderbibliothek.app.ui.components.SecondaryButton
import org.wanderbibliothek.app.ui.components.SectionTitle
import org.wanderbibliothek.app.ui.errorText

@Composable
fun OfferScreen(
    viewModel: AppViewModel,
    session: SessionState,
    onPublished: () -> Unit,
    onSignIn: () -> Unit,
) {
    val texts = LocalTexts.current
    val lang = LocalLang.current
    val scope = rememberCoroutineScope()

    val user = (session as? SessionState.SignedIn)?.user
    if (user == null) {
        SignInPrompt(texts, text = texts["signInToSee"], onSignIn = onSignIn)
        return
    }

    var isbn by rememberSaveable { mutableStateOf("") }
    var title by rememberSaveable { mutableStateOf("") }
    var author by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf(Catalogs.categories.first()) }
    var condition by rememberSaveable { mutableStateOf(Catalogs.conditions.first()) }
    var language by rememberSaveable { mutableStateOf(Catalogs.languages.first()) }
    var city by rememberSaveable { mutableStateOf(user.city) }
    var selectedTags by remember { mutableStateOf(listOf<String>()) }
    var busy by remember { mutableStateOf(false) }
    var lookingUp by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var isError by remember { mutableStateOf(false) }

    val availableTags = remember(category) {
        Catalogs.tagsFor(category).ifEmpty { Catalogs.tags }
    }

    fun publish() {
        if (title.trim().length < 2 || author.trim().length < 2 || city.isBlank()) {
            notice = texts["requiredField"]
            isError = true
            return
        }
        scope.launch {
            busy = true
            isError = false
            try {
                viewModel.repo.createListing(
                    title = title,
                    author = author,
                    category = category,
                    condition = condition,
                    language = language,
                    city = city,
                    isbn = isbn,
                    tags = selectedTags,
                )
                notice = texts["published"]
                onPublished()
            } catch (failure: Exception) {
                isError = true
                notice = errorText(texts, failure)
            } finally {
                busy = false
            }
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(texts["offerTitle"], style = MaterialTheme.typography.headlineSmall)
        Text(
            text = texts["offerSubtitle"],
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        notice?.let { Notice(it, isError = isError) }

        FormField(
            value = isbn,
            onValueChange = { isbn = it.filter { char -> char.isDigit() || char == 'X' || char == 'x' } },
            label = texts["isbnHint"],
            keyboardType = KeyboardType.Number,
        )
        SecondaryButton(
            text = texts["lookupIsbn"],
            enabled = isbn.isNotBlank() && !lookingUp,
            onClick = {
                scope.launch {
                    lookingUp = true
                    isError = false
                    notice = null
                    try {
                        val result = viewModel.repo.lookupIsbn(isbn)
                        val metadata = result.metadata
                        when {
                            result.existingTitle != null -> {
                                notice = result.existingTitle
                            }
                            metadata != null -> {
                                title = metadata.title
                                author = metadata.author
                                metadata.category?.let { category = it }
                                metadata.language?.let { language = it }
                                if (metadata.tags.isNotEmpty()) {
                                    selectedTags = metadata.tags.take(3)
                                }
                                notice = null
                            }
                            else -> {
                                isError = true
                                notice = texts["isbnNotFound"]
                            }
                        }
                    } catch (failure: Exception) {
                        isError = true
                        notice = errorText(texts, failure)
                    } finally {
                        lookingUp = false
                    }
                }
            },
        )

        FormField(title, { title = it }, texts["title"])
        FormField(author, { author = it }, texts["author"])
        FormField(city, { city = it }, texts["city"])

        SectionTitle(texts["category"])
        ChoiceChips(
            options = Catalogs.categories.map { it to Labels.of(it, lang) },
            selected = category,
            onSelect = {
                category = it
                selectedTags = selectedTags.filter { tag -> Catalogs.tagsFor(it).contains(tag) }
            },
        )

        SectionTitle(texts["condition"])
        ChoiceChips(
            options = Catalogs.conditions.map { it to Labels.of(it, lang) },
            selected = condition,
            onSelect = { condition = it },
        )

        SectionTitle(texts["language"])
        ChoiceChips(
            options = Catalogs.languages.map { it to Labels.of(it, lang) },
            selected = language,
            onSelect = { language = it },
        )

        SectionTitle(texts["tags"])
        MultiChoiceChips(
            options = availableTags.map { it to Labels.of(it, lang) },
            selected = selectedTags.toSet(),
            onToggle = { tag ->
                selectedTags = when {
                    selectedTags.contains(tag) -> selectedTags - tag
                    selectedTags.size >= 3 -> selectedTags
                    else -> selectedTags + tag
                }
            },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            selectedTags.forEach { tag ->
                Text(
                    text = "✓ ${Labels.of(tag, lang)}",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }

        Spacer(Modifier.height(4.dp))
        ActionButton(
            text = texts["publish"],
            loading = busy,
            onClick = { publish() },
        )
        Spacer(Modifier.height(12.dp))
    }
}
