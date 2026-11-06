plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

val signingEnvironment = listOf(
    providers.environmentVariable("ANDROID_SIGNING_STORE_FILE").orNull,
    providers.environmentVariable("ANDROID_SIGNING_STORE_PASSWORD").orNull,
    providers.environmentVariable("ANDROID_SIGNING_KEY_ALIAS").orNull,
    providers.environmentVariable("ANDROID_SIGNING_KEY_PASSWORD").orNull,
)
val hasReleaseSigning = signingEnvironment.all { !it.isNullOrBlank() }
if (signingEnvironment.any { !it.isNullOrBlank() } && !hasReleaseSigning) {
    throw GradleException("Set all four ANDROID_SIGNING_* variables to sign a release build.")
}

android {
    namespace = "org.wanderbibliothek.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "org.wanderbibliothek.app"
        minSdk = 24
        targetSdk = 37
        versionCode = 8
        versionName = "0.1.5"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(signingEnvironment[0]!!)
                storePassword = signingEnvironment[1]
                keyAlias = signingEnvironment[2]
                keyPassword = signingEnvironment[3]
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.datastore:datastore-preferences:1.3.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.navigation:navigation-compose:2.10.2")

    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
    // En la JVM `org.json` del SDK es un stub que lanza, así que las pruebas de
    // los modelos necesitan la implementación real.
    testImplementation("org.json:json:20240303")
}
