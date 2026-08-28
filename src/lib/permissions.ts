/**
 * Permission helpers
 *
 * As permissões sao solicitadas APENAS quando o usuario
 * tenta usar a feature que precisa delas. Nao no inicio do app.
 */

const CAMERA_KEY = 'floorvision_camera_granted';

export async function requestCameraPermission(): Promise<boolean> {
  // Se ja foi concedida antes, retorna true sem pedir
  if (typeof window !== 'undefined' && localStorage.getItem(CAMERA_KEY) === 'true') {
    return true;
  }

  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    // Tenta getPhoto com source=Camera - isso dispara o prompt
    await Camera.getPhoto({
      quality: 10,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera,
      saveToGallery: false,
    });
    if (typeof window !== 'undefined') {
      localStorage.setItem(CAMERA_KEY, 'true');
    }
    return true;
  } catch (e) {
    console.warn('Camera permission denied or error:', e);
    return false;
  }
}

export function hasCameraPermission(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(CAMERA_KEY) === 'true';
}

export function clearCameraPermission() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(CAMERA_KEY);
  }
}
