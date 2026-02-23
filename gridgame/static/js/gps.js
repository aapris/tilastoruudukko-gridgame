/**
 * GPS tracking and dwell timer logic.
 */
const GPS = {
  watchId: null,

  /**
   * Start watching the user's position.
   * @param {Function} onUpdate - Callback with (lat, lon, accuracy).
   * @param {Function} onError - Callback with error message.
   */
  start(onUpdate, onError) {
    if (!navigator.geolocation) {
      onError('Geolocation is not supported by this browser.');
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        onUpdate(
          position.coords.latitude,
          position.coords.longitude,
          position.coords.accuracy
        );
      },
      (err) => {
        onError(`GPS error: ${err.message}`);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 5000,
      }
    );
  },

  /**
   * Stop watching the user's position.
   */
  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  },

  /**
   * Get the current position as a one-shot request.
   * @returns {Promise<{lat: number, lon: number}>}
   */
  getCurrentPosition() {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => reject(new Error(`GPS error: ${err.message}`)),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  },
};
