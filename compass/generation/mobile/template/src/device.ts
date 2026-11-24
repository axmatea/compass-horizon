import AsyncStorage from '@react-native-async-storage/async-storage';
import {File, Paths} from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import {Platform} from 'react-native';
import {decodeWorkspace, reminderDate, type Task, type Workspace} from './workspace';

const storageKey = 'compass-personal-os:workspace:v1';
const reminderPrefix = 'personal-os-follow-up-';
const channelId = 'follow-ups';
const imageName = /^personal-os-[0-9-]+\.(?:jpg|png|webp|heic)$/;
export const onDevice = Platform.OS === 'ios' || Platform.OS === 'android';

if (onDevice) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false}),
  });
}

export async function readWorkspace() {
  return decodeWorkspace(await AsyncStorage.getItem(storageKey));
}

export async function writeWorkspace(workspace: Workspace) {
  await AsyncStorage.setItem(storageKey, JSON.stringify(workspace));
}

export async function pendingReminders(): Promise<Set<number>> {
  if (!onDevice) return new Set();
  const requests = await Notifications.getAllScheduledNotificationsAsync();
  return new Set(requests.filter(request => request.identifier.startsWith(reminderPrefix))
    .map(request => Number(request.identifier.slice(reminderPrefix.length))).filter(Number.isSafeInteger));
}

export async function scheduleReminder(task: Task) {
  if (!onDevice) throw new Error('Reminders are available on iOS and Android.');
  const date = reminderDate(task.dueDate);
  if (task.done || task.category !== 'follow-up' || !date) throw new Error('Choose a follow-up due after today at 9:00 AM.');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(channelId, {name: 'Follow-ups', importance: Notifications.AndroidImportance.DEFAULT});
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && !(await Notifications.requestPermissionsAsync()).granted) {
    throw new Error('Allow notifications in device settings to schedule a reminder.');
  }
  await Notifications.scheduleNotificationAsync({
    identifier: reminderPrefix + task.id,
    content: {title: 'Personal OS', body: 'A follow-up is due. Open your workspace for details.'},
    trigger: {type: Notifications.SchedulableTriggerInputTypes.DATE, date, ...(Platform.OS === 'android' ? {channelId} : {})},
  });
}

export async function cancelReminder(id: number) {
  if (onDevice) await Notifications.cancelScheduledNotificationAsync(reminderPrefix + id);
}

export function photoDisplayUri(uri: string) {
  const name = uri.split('/').at(-1) || '';
  return onDevice && imageName.test(name) ? new File(Paths.document, name).uri : '';
}

export function deletePhoto(uri: string) {
  const path = photoDisplayUri(uri);
  if (!path) return;
  const file = new File(path);
  if (file.exists) file.delete();
}

export async function pickPhoto(fromCamera: boolean, projectId: number) {
  if (!onDevice) throw new Error('Photo attachments are available on iOS and Android.');
  if (fromCamera) {
    const current = await ImagePicker.getCameraPermissionsAsync();
    if (!current.granted && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
      throw new Error('Allow camera access in Settings to take a photo.');
    }
  }
  const options: ImagePicker.ImagePickerOptions = {mediaTypes: ['images'], quality: 0.75, selectionLimit: 1};
  const result = fromCamera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset || typeof asset.fileSize === 'number' && asset.fileSize > 10 * 1024 * 1024) {
    throw new Error('Choose a photo under 10 MB.');
  }
  const image = new File(asset.uri);
  if (!image.exists || image.size > 10 * 1024 * 1024) throw new Error('Choose a photo under 10 MB.');
  const extension = /\.(jpg|png|webp|heic)$/i.exec(asset.fileName || asset.uri)?.[1].toLowerCase() || 'jpg';
  const destination = new File(Paths.document, 'personal-os-' + projectId + '-' + Date.now() + '.' + extension);
  image.copy(destination);
  return destination.uri;
}
