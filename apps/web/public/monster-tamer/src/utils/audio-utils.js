/**
 * @param {Phaser.Scene} scene The Phaser 3 scene to play audio in
 * @param {string} audioKey The key of the audio asset that should be played
 * @returns {void}
 */
export function playBackgroundMusic(scene, audioKey) {
  // get all of the audio objects that are currently playing so we can check if the sound we
  // want to play is already playing, and to stop all other sounds
  const existingSounds = scene.sound.getAllPlaying();
  let musicAlreadyPlaying = false;

  existingSounds.forEach((sound) => {
    if (sound.key === audioKey) {
      musicAlreadyPlaying = true;
      return;
    }
    sound.stop();
  });

  if (!musicAlreadyPlaying) {
    scene.sound.play(audioKey, {
      loop: true,
    });
  }
}

/**
 * @param {Phaser.Scene} scene The Phaser 3 scene to play audio in
 * @param {string} audioKey The key of the audio asset that should be played
 * @returns {void}
 */
export function playSoundFx(scene, audioKey) {
  scene.sound.play(audioKey, {
    volume: 20,
  });
}

/**
 * @param {Phaser.Scene} scene The Phaser 3 scene to get the sound manager reference from
 * @returns {void}
 */
export function initializeGlobalSound(scene) {
  scene.sound.setVolume(1);
  scene.sound.setMute(false);
}
