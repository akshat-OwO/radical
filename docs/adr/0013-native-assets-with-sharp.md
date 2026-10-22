# Generate native assets with sharp

Supersedes the icon and splash writer decision in [ADR 0001](0001-framework-agnostic-native-shell-plugin.md). Radical already validates and composites source pixels with `sharp`. It now writes Android resources and iOS catalogs directly, removing the external asset CLI, its exact version requirement, and its generated-project dependency. Four concurrent image jobs bound decoding and encoding work; identical outputs share an encode.

The reference inventory captured from main at `3fe36dc` defines the required file set and dimensions. Content-derived `RadicalSplash<hash>.imageset` names preserve UIKit launch-image cache invalidation. Android gains API 33 monochrome resources. The config supports one icon artwork, so day and night modes share adaptive XML without competing night launcher rasters. Legacy padding, round masks, adaptive insets, density sizes, and dark splashes preserve the existing contract.

Encode iOS splashes directly at 2048×2048 and declare the storyboard image as 1024×1024 points. This keeps decoded launch images below the observed iOS allocation limit without encoding oversized images and then downsampling them. Keep the separate square Android system splash because Android 12 uses an icon slot rather than a full-screen portrait drawable. Both constraints remain useful independently of the removed CLI. The storyboard and startup overlay use the same content-derived name as the catalog. Regeneration removes stale hashed catalogs.

See [verification](../verification/native-assets.md) for the baseline comparison, tests, builds, and device evidence limits.
