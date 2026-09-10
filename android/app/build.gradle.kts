plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// google-services.json 을 넣기 전에도 빌드가 되도록 조건부로 적용합니다.
// (파일을 넣은 뒤에는 자동으로 활성화됩니다.)
val hasGoogleServices = file("google-services.json").exists()
if (hasGoogleServices) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "kr.ai.shy.postit"
    compileSdk = 36

    defaultConfig {
        applicationId = "kr.ai.shy.postit"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // 별도 서명 키가 없어도 바로 설치해 볼 수 있게 디버그 키로 서명합니다.
            signingConfig = signingConfigs.getByName("debug")
        }
        // debug 도 같은 applicationId 를 씁니다.
        // (google-services.json 과 Google 로그인 SHA-1 등록이 패키지명 기준이라 접미사를 붙이면 매칭이 깨집니다.)
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
    }
}

dependencies {
    implementation(platform("com.google.firebase:firebase-bom:34.19.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-database")

    // Google 로그인 (Credential Manager — 현재 권장 방식)
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")

    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.recyclerview:recyclerview:1.4.0")
    implementation("androidx.constraintlayout:constraintlayout:2.2.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.4")
    implementation("androidx.work:work-runtime-ktx:2.10.5")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")
}
