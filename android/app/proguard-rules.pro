# Firebase Realtime Database 는 리플렉션으로 모델을 읽고 씁니다.
-keepattributes Signature
-keepclassmembers class kr.ai.shy.postit.** {
  *;
}
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**
