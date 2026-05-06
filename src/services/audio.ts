import playSound from 'play-sound';
import { Dependencies } from '../types';

export function getAudioPlayer(deps: Dependencies): any {
  if (!deps.audioPlayer) {
    try {
      deps.audioPlayer = playSound({});
    } catch (error) {
      console.error('Failed to initialize audio player:', error);
      console.error('Server-side audio playback will not be available');
      deps.audioPlayer = {
        play: () => {
          throw new Error('Audio player initialization failed - playback not available');
        }
      };
    }
  }
  return deps.audioPlayer;
}
