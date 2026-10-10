export type Coordinates = { latitude: number; longitude: number; verified: boolean };
export type RoadDistance = { km: number; method: "manual" | "fetched" };
export type GeoResult = { status: "success"; coordinates: Coordinates; accuracyMetres?: number | null } | { status: "denied" | "timeout" | "unsupported" | "unavailable" };

export function validCoordinates(value: Coordinates | null | undefined): value is Coordinates {
  return !!value && value.verified && Number.isFinite(value.latitude) && Number.isFinite(value.longitude) &&
    Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180;
}
export function directionsUrl(destination: Coordinates | null | undefined): string | null {
  return validCoordinates(destination)
    ? `https://www.google.com/maps/dir/?api=1&destination=${destination.latitude},${destination.longitude}` : null;
}
/** Called only from the user's location button. No reverse-geocoding claim is made. */
export function requestLocation(api: Pick<Geolocation, "getCurrentPosition"> | undefined): Promise<GeoResult> {
  if (!api) return Promise.resolve({ status: "unsupported" });
  return new Promise((resolve) => {
    try {
      api.getCurrentPosition((position) => {
        const coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude, verified: true };
        const accuracyMetres = Number.isFinite(position.coords.accuracy) && position.coords.accuracy >= 0 ? position.coords.accuracy : null;
        resolve(validCoordinates(coordinates) ? { status: "success", coordinates, accuracyMetres } : { status: "unavailable" });
      }, (error) => resolve({ status: error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable" }),
      { timeout: 10000, maximumAge: 0, enableHighAccuracy: false });
    } catch { resolve({ status: "unavailable" }); }
  });
}
