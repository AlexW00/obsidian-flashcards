---
name: mobile-development
description: Use this skill when making changees related to the mobile version of this plugin
---

Background: this plugin also works on Obsidian Mobile - which is quite different from Obsidian Desktop.
To achieve consistent design, its necessary to use Obsidian variables / components instead of custom ones.

---

## Best Practices for iOS Plugin Styling in Obsidian

## 1. **Platform Detection**

Obsidian provides built-in platform detection through the `Platform` API:[obsidian+1](https://docs.obsidian.md/Plugins/Getting+started/Mobile+development)

typescript

`import { Platform } from 'obsidian'; if (Platform.isIosApp) {     // iOS-specific code } if (Platform.isMobileApp) {     // Mobile (iOS or Android) } if (Platform.isPhone) {     // Phone-sized screen } if (Platform.isTablet) {     // Tablet-sized screen }`

## 2. **CSS Safe Area Variables**

Obsidian supports CSS safe area inset variables to handle notches and floating UI elements. Use these in your plugin's CSS:[[github](https://github.com/st3v3nmw/obsidian-spaced-repetition/discussions/990)]​

css

`/* Basic safe area usage */ .your-plugin-element {     padding-top: env(safe-area-inset-top);    padding-right: env(safe-area-inset-right);    padding-bottom: env(safe-area-inset-bottom);    padding-left: env(safe-area-inset-left); } /* With fallback values */ .your-element {     padding-top: max(12px, env(safe-area-inset-top));    padding-bottom: max(12px, env(safe-area-inset-bottom)); } /* Calculate height accounting for safe areas */ .full-height-element {     height: calc(100vh - var(--safe-area-inset-top) - var(--safe-area-inset-bottom)); }`

## 3. **Obsidian-Specific CSS Variables**

Obsidian provides variables that account for its own UI elements:[[github](https://github.com/st3v3nmw/obsidian-spaced-repetition/discussions/990)]​

css

`.is-mobile #your-modal {     --top-space: calc(var(--safe-area-inset-top) + var(--header-height) + var(--size-4-2));    height: calc(100vh - var(--top-space)) !important;    margin-top: var(--top-space); }`

## 4. **Mobile-Specific CSS Classes**

Use these classes to target mobile devices specifically:[obsidian+1](https://forum.obsidian.md/t/adding-ios-and-ipados-compatibility-to-plugin/32305)

css

`/* Target mobile devices */ .is-mobile .your-element {     /* Mobile-specific styles */ } /* Target phone-sized screens */ .is-phone .your-element {     /* Phone-specific styles */ } /* Target tablet-sized screens */ .is-tablet .your-element {     /* Tablet-specific styles */ }`

## 5. **Common Patterns for Floating Elements**

css

`/* Floating button that respects safe areas */ .floating-button {     position: fixed;    bottom: calc(env(safe-area-inset-bottom) + 20px);    right: calc(env(safe-area-inset-right) + 20px); } /* Full-screen modal avoiding UI overlays */ .plugin-modal {     position: fixed;    top: env(safe-area-inset-top);    left: env(safe-area-inset-left);    right: env(safe-area-inset-right);    bottom: env(safe-area-inset-bottom); } /* Toolbar at bottom avoiding iOS home indicator */ .bottom-toolbar {     position: fixed;    bottom: 0;    left: 0;    right: 0;    padding-bottom: max(8px, env(safe-area-inset-bottom)); }`

## 6. **Media Queries for Landscape Mode**

Handle landscape orientation on phones:[[github](https://github.com/st3v3nmw/obsidian-spaced-repetition/discussions/990)]​

css

`@media only screen and (min-device-width: 480px) and (orientation: landscape) {     .is-phone .your-element {        /* Landscape-specific layout */        flex-direction: row;    } }`

## 7. **Viewport Meta Tag Requirement**

Ensure your plugin doesn't interfere with the viewport settings. The safe area variables only work with proper viewport configuration (Obsidian handles this, but be aware):[[github](https://github.com/capacitor-community/safe-area)]​

xml

`<meta name="viewport" content="viewport-fit=cover" />`

## Key Recommendations

1. **Always use `env(safe-area-inset-*)` for positioning** - This automatically adjusts for notches, home indicators, and rounded corners
2. **Test with mobile emulation first** - Use `app.emulateMobile(true)` during development
3. **Use Obsidian's CSS variables** - Leverage `--header-height` and other built-in variables[[docs.obsidian](https://docs.obsidian.md/Reference/CSS+variables/About+styling)]​
4. **Provide fallbacks** - Use `max()` function to ensure minimum spacing even on devices without safe areas
5. **Consider both portrait and landscape** - Test your UI in both orientations, especially for phones
6. **Check manifest.json** - Ensure `"isDesktopOnly": false` in your plugin's manifest[[reddit](https://www.reddit.com/r/ObsidianMD/comments/10fnz8d/how_do_i_know_if_a_plugin_is_compatible_with_the/)]​

## Official Resources

While there isn't a single comprehensive guide, these are the official documentation sources:

- **Obsidian Developer Docs**: [https://docs.obsidian.md/Plugins/Getting+started/Mobile+development](https://docs.obsidian.md/Plugins/Getting+started/Mobile+development)[[docs.obsidian](https://docs.obsidian.md/Plugins/Getting+started/Mobile+development)]​
- **CSS Variables Reference**: [https://docs.obsidian.md/Reference/CSS+variables/About+styling](https://docs.obsidian.md/Reference/CSS+variables/About+styling)[[docs.obsidian](https://docs.obsidian.md/Reference/CSS+variables/About+styling)]​
- **Platform API**: Available in the obsidian.d.ts type definitions

The key is combining standard web safe area CSS with Obsidian's platform detection and built-in CSS variables to create a responsive, iOS-friendly plugin interface.
