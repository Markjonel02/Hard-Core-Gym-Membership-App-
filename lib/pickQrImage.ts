/**
 * Picks an image from the device library and returns a URI `scanFromURLAsync` can fetch.
 *
 * Native implementation. The web build resolves `pickQrImage.web.ts` instead, which uses a file
 * input — `expo-image-picker` is a native module and the split keeps it off the web bundle
 * entirely rather than shipping a shim that would never run.
 *
 * Resolves `null` when the picker is dismissed, which is a normal outcome and not an error.
 */
export async function pickQrImage(): Promise<string | null> {
  const ImagePicker = await import('expo-image-picker');

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo access is needed to pick a QR image. Enable it in system settings.');
  }

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    // No cropping: a QR needs its quiet zone and finder patterns intact, and an editor is one
    // more way for the person at the desk to hand the decoder an unreadable crop.
    allowsEditing: false,
    quality: 1,
  });

  if (picked.canceled) return null;
  return picked.assets[0]?.uri ?? null;
}

/** Web revokes an object URL here; native has nothing to clean up. */
export function releaseQrImage(_uri: string): void {}
