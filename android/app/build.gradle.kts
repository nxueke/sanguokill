plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.sanguokill.game"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.sanguokill.game"
        minSdk = 24
        targetSdk = 35
        versionCode = 4
        versionName = "0.4.0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}


dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
