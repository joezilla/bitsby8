import * as path from 'path';
import * as fs from 'fs/promises';
import { Dependencies } from '../types';

export async function listDiskImages(deps: Dependencies): Promise<string[]> {
  try {
    await fs.mkdir(deps.config.disksDir, { recursive: true });
    const files = await fs.readdir(deps.config.disksDir);
    return files.filter((file) => file.match(/\.(dsk|img|ima)$/i)).sort();
  } catch (error) {
    console.error('Error listing disk images:', error);
    return [];
  }
}

export async function listDiskImagesWithDetails(
  deps: Dependencies
): Promise<Array<{ name: string; size: number; description: string; notes: string }>> {
  try {
    await fs.mkdir(deps.config.disksDir, { recursive: true });
    const files = await fs.readdir(deps.config.disksDir);
    const diskFiles = files.filter((file) => file.match(/\.(dsk|img|ima)$/i));
    const notesMap = await deps.database.getAllDiskNotes();

    const fileDetails = await Promise.all(
      diskFiles.map(async (file) => {
        try {
          const filePath = path.join(deps.config.disksDir, file);
          const stats = await fs.stat(filePath);
          const note = notesMap.get(file);
          return {
            name: file,
            size: stats.size,
            description: note?.description || '',
            notes: note?.notes || '',
          };
        } catch (error) {
          console.error(`Error getting stats for ${file}:`, error);
          return { name: file, size: 0, description: '', notes: '' };
        }
      })
    );

    return fileDetails.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Error listing disk images with details:', error);
    return [];
  }
}

export async function listCassettesWithDetails(
  deps: Dependencies
): Promise<Array<{ name: string; size: number; duration?: number; description: string; notes: string }>> {
  try {
    await fs.mkdir(deps.config.cassettesDir, { recursive: true });
    const files = await fs.readdir(deps.config.cassettesDir);
    const wavFiles = files.filter((file) => file.match(/\.wav$/i));
    const notesMap = await deps.database.getAllCassetteNotes();

    const fileDetails = await Promise.all(
      wavFiles.map(async (file) => {
        try {
          const filePath = path.join(deps.config.cassettesDir, file);
          const stats = await fs.stat(filePath);
          const note = notesMap.get(file);
          return {
            name: file,
            size: stats.size,
            description: note?.description || '',
            notes: note?.notes || '',
          };
        } catch (error) {
          console.error(`Error getting stats for ${file}:`, error);
          return { name: file, size: 0, description: '', notes: '' };
        }
      })
    );

    return fileDetails.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Error listing cassettes with details:', error);
    return [];
  }
}
