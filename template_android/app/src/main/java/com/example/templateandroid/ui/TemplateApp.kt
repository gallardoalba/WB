package com.example.templateandroid.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.example.templateandroid.R
import com.example.templateandroid.data.ThemePreference
import com.example.templateandroid.ui.screens.ComponentsScreen
import com.example.templateandroid.ui.screens.HomeScreen
import com.example.templateandroid.ui.screens.SettingsScreen
import com.example.templateandroid.ui.theme.TemplateTheme

private data class AppDestination(
    val route: String,
    val labelRes: Int,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
) {
    companion object {
        val items = listOf(
            AppDestination("home", R.string.nav_home, Icons.Default.Home),
            AppDestination("components", R.string.nav_components, Icons.Default.Build),
            AppDestination("settings", R.string.nav_settings, Icons.Default.Settings),
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TemplateApp(appViewModel: AppViewModel = viewModel()) {
    val themePreference by appViewModel.themePreference.collectAsStateWithLifecycle()
    val systemDarkTheme = isSystemInDarkTheme()
    val darkTheme = when (themePreference) {
        ThemePreference.SYSTEM -> systemDarkTheme
        ThemePreference.LIGHT -> false
        ThemePreference.DARK -> true
    }
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = backStackEntry?.destination
    val currentLabel = AppDestination.items.firstOrNull { destination ->
        currentDestination?.hierarchy?.any { it.route == destination.route } == true
    }?.labelRes ?: R.string.app_name

    TemplateTheme(darkTheme = darkTheme) {
        Scaffold(
            topBar = { TopAppBar(title = { Text(stringResource(currentLabel)) }) },
            bottomBar = {
                NavigationBar {
                    AppDestination.items.forEach { destination ->
                        val selected = currentDestination?.hierarchy?.any {
                            it.route == destination.route
                        } == true
                        NavigationBarItem(
                            selected = selected,
                            onClick = {
                                navController.navigate(destination.route) {
                                    popUpTo("home") {
                                        saveState = true
                                    }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = {
                                Icon(
                                    imageVector = destination.icon,
                                    contentDescription = stringResource(destination.labelRes),
                                )
                            },
                            label = { Text(stringResource(destination.labelRes)) },
                        )
                    }
                }
            },
        ) { contentPadding ->
            NavHost(
                navController = navController,
                startDestination = "home",
                modifier = Modifier.padding(contentPadding),
            ) {
                composable("home") {
                    HomeScreen(
                        onOpenComponents = { navController.navigate("components") },
                    )
                }
                composable("components") { ComponentsScreen() }
                composable("settings") {
                    SettingsScreen(
                        themePreference = themePreference,
                        onThemePreferenceChange = appViewModel::setThemePreference,
                    )
                }
            }
        }
    }
}