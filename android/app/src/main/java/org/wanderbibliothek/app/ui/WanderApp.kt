package org.wanderbibliothek.app.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import org.wanderbibliothek.app.data.ImageUrl
import org.wanderbibliothek.app.data.ThemePreference
import org.wanderbibliothek.app.ui.screens.AccountScreen
import org.wanderbibliothek.app.ui.screens.ClubDetailScreen
import org.wanderbibliothek.app.ui.screens.ClubsScreen
import org.wanderbibliothek.app.ui.screens.DiscoverScreen
import org.wanderbibliothek.app.ui.screens.ExchangeDetailScreen
import org.wanderbibliothek.app.ui.screens.ExchangesScreen
import org.wanderbibliothek.app.ui.screens.ListDetailScreen
import org.wanderbibliothek.app.ui.screens.ListingDetailScreen
import org.wanderbibliothek.app.ui.screens.ListsScreen
import org.wanderbibliothek.app.ui.screens.LoginScreen
import org.wanderbibliothek.app.ui.screens.NotificationsScreen
import org.wanderbibliothek.app.ui.screens.OfferScreen
import org.wanderbibliothek.app.ui.screens.PasswordScreen
import org.wanderbibliothek.app.ui.screens.ProfileEditScreen
import org.wanderbibliothek.app.ui.screens.RegisterScreen
import org.wanderbibliothek.app.ui.screens.SettingsScreen
import org.wanderbibliothek.app.ui.screens.ShelfScreen
import org.wanderbibliothek.app.ui.screens.TwoFactorScreen
import org.wanderbibliothek.app.ui.theme.WanderTheme
import java.util.Locale

enum class TopDestination(
    val route: String,
    val labelKey: String,
    val icon: ImageVector,
) {
    DISCOVER("discover", "discover", Icons.Filled.Search),
    SHELF("shelf", "shelf", Icons.AutoMirrored.Filled.List),
    EXCHANGES("exchanges", "exchanges", Icons.AutoMirrored.Filled.Send),
    CLUBS("clubs", "clubs", Icons.Filled.Star),
    ACCOUNT("account", "account", Icons.Filled.Person),
}

@Composable
fun WanderApp(viewModel: AppViewModel = viewModel()) {
    val settingsValue by viewModel.settings.collectAsStateWithLifecycle()
    val session by viewModel.session.collectAsStateWithLifecycle()
    val settings = settingsValue

    // Hasta que DataStore no responde no se sabe contra qué servidor hablar:
    // componer el catálogo antes pediría las portadas al servidor por defecto.
    if (settings == null) {
        WanderTheme(preference = ThemePreference.SYSTEM) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }
        return
    }
    ImageUrl.baseUrl = settings.serverUrl

    // «system» sigue al idioma del teléfono; por defecto, alemán, igual que la
    // plataforma. El castellano se elige en Ajustes o si el sistema está en es.
    val language = remember(settings.language) {
        when (settings.language) {
            "de", "es" -> settings.language
            else -> if (Locale.getDefault().language == "es") "es" else "de"
        }
    }
    val texts = remember(language) { TextCatalog.forLanguage(language) }

    WanderTheme(preference = settings.theme) {
        CompositionLocalProvider(LocalTexts provides texts, LocalLang provides language) {
            AppScaffold(viewModel = viewModel, session = session)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AppScaffold(viewModel: AppViewModel, session: SessionState) {
    val texts = LocalTexts.current
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val route = backStackEntry?.destination?.route ?: TopDestination.DISCOVER.route
    val topDestination = TopDestination.entries.firstOrNull { it.route == route }
    val signedIn = session is SessionState.SignedIn

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(titleFor(route, texts)) },
                navigationIcon = {
                    if (topDestination == null) {
                        IconButton(onClick = { navController.popBackStack() }) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = texts["back"],
                            )
                        }
                    }
                },
                actions = {
                    if (signedIn) {
                        IconButton(onClick = { navController.navigate("notifications") }) {
                            Icon(
                                imageVector = Icons.Filled.Notifications,
                                contentDescription = texts["notifications"],
                            )
                        }
                    }
                },
            )
        },
        bottomBar = {
            if (topDestination != null) {
                BottomBar(navController, topDestination)
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = TopDestination.DISCOVER.route,
            modifier = Modifier.padding(padding),
        ) {
            composable(TopDestination.DISCOVER.route) {
                DiscoverScreen(
                    viewModel = viewModel,
                    onOpenListing = { navController.navigate("listing/$it") },
                )
            }
            composable(TopDestination.SHELF.route) {
                ShelfScreen(
                    viewModel = viewModel,
                    session = session,
                    onOpenListing = { navController.navigate("listing/$it") },
                    onSignIn = { navController.navigate("login") },
                    onOffer = { navController.navigate("offer") },
                )
            }
            composable(TopDestination.EXCHANGES.route) {
                ExchangesScreen(
                    viewModel = viewModel,
                    session = session,
                    onOpenExchange = { navController.navigate("exchange/$it") },
                    onSignIn = { navController.navigate("login") },
                )
            }
            composable(TopDestination.CLUBS.route) {
                ClubsScreen(
                    viewModel = viewModel,
                    session = session,
                    onOpenClub = { navController.navigate("club/$it") },
                    onSignIn = { navController.navigate("login") },
                )
            }
            composable(TopDestination.ACCOUNT.route) {
                AccountScreen(
                    viewModel = viewModel,
                    session = session,
                    onSignIn = { navController.navigate("login") },
                    onNotifications = { navController.navigate("notifications") },
                    onLists = { navController.navigate("lists") },
                    onSettings = { navController.navigate("settings") },
                    onEditProfile = { navController.navigate("profile") },
                    onChangePassword = { navController.navigate("password") },
                    onTwoFactor = { navController.navigate("twofactor") },
                    onDeleted = {
                        // La cuenta ya no existe: se vuelve al catálogo y se
                        // limpia la pila para no volver a pantallas de sesión.
                        navController.navigate(TopDestination.DISCOVER.route) {
                            popUpTo(navController.graph.findStartDestination().id) {
                                inclusive = true
                            }
                        }
                    },
                )
            }
            composable("login") {
                LoginScreen(
                    viewModel = viewModel,
                    onSignedIn = { navController.popBackStack() },
                    onRegister = { navController.navigate("register") },
                )
            }
            composable("register") {
                RegisterScreen(
                    viewModel = viewModel,
                    onRegistered = {
                        navController.popBackStack()
                    },
                    onSignIn = { navController.popBackStack() },
                )
            }
            composable("listing/{id}") { entry ->
                val id = entry.arguments?.getString("id").orEmpty()
                ListingDetailScreen(
                    viewModel = viewModel,
                    listingId = id,
                    onOpenListing = { navController.navigate("listing/$it") },
                    onSignIn = { navController.navigate("login") },
                    onDeleted = { navController.popBackStack() },
                )
            }
            composable("offer") {
                OfferScreen(
                    viewModel = viewModel,
                    session = session,
                    onPublished = { navController.popBackStack() },
                    onSignIn = { navController.navigate("login") },
                )
            }
            composable("exchange/{id}") { entry ->
                val id = entry.arguments?.getString("id").orEmpty()
                ExchangeDetailScreen(
                    viewModel = viewModel,
                    exchangeId = id,
                    session = session,
                )
            }
            composable("club/{id}") { entry ->
                val id = entry.arguments?.getString("id").orEmpty()
                ClubDetailScreen(viewModel = viewModel, clubId = id)
            }
            composable("lists") {
                ListsScreen(
                    viewModel = viewModel,
                    session = session,
                    onOpenList = { navController.navigate("list/$it") },
                    onSignIn = { navController.navigate("login") },
                )
            }
            composable("list/{id}") { entry ->
                val id = entry.arguments?.getString("id").orEmpty()
                ListDetailScreen(
                    viewModel = viewModel,
                    listId = id,
                    onDeleted = { navController.popBackStack() },
                )
            }
            composable("notifications") {
                NotificationsScreen(
                    viewModel = viewModel,
                    session = session,
                    onOpen = { route -> navController.navigate(route) },
                )
            }
            composable("settings") {
                SettingsScreen(viewModel = viewModel, session = session)
            }
            composable("profile") {
                ProfileEditScreen(
                    viewModel = viewModel,
                    session = session,
                    onSaved = { navController.popBackStack() },
                )
            }
            composable("password") {
                PasswordScreen(
                    viewModel = viewModel,
                    onChanged = { navController.popBackStack() },
                )
            }
            composable("twofactor") {
                TwoFactorScreen(viewModel = viewModel)
            }
        }
    }
}

@Composable
private fun BottomBar(navController: NavHostController, current: TopDestination) {
    val texts = LocalTexts.current
    NavigationBar {
        TopDestination.entries.forEach { destination ->
            NavigationBarItem(
                selected = current == destination,
                onClick = {
                    navController.navigate(destination.route) {
                        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                },
                icon = {
                    Icon(
                        imageVector = destination.icon,
                        contentDescription = texts[destination.labelKey],
                    )
                },
                label = { Text(texts[destination.labelKey]) },
            )
        }
    }
}

private fun titleFor(route: String, texts: Texts): String = when {
    route.startsWith("listing/") -> texts["listing"]
    route.startsWith("exchange/") -> texts["exchange"]
    route.startsWith("club/") -> texts["club"]
    route.startsWith("list/") -> texts["readingList"]
    route == "offer" -> texts["offerTitle"]
    route == "login" -> texts["signIn"]
    route == "register" -> texts["register"]
    route == "notifications" -> texts["notifications"]
    route == "settings" -> texts["settings"]
    route == "profile" -> texts["editProfile"]
    route == "password" -> texts["changePassword"]
    route == "twofactor" -> texts["twoFactor"]
    route == "lists" -> texts["readingLists"]
    else -> TopDestination.entries.firstOrNull { it.route == route }
        ?.let { texts[it.labelKey] }
        ?: texts["discover"]
}
