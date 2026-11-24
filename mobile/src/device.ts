import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import {File} from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import {Platform} from 'react-native';

Notifications.setNotificationHandler({handleNotification: async () => ({
  shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
})});

export async function enableCompletionNotifications() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('build-completion', {
      name: 'Build completion', importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  return (await Notifications.requestPermissionsAsync()).granted;
}

export async function notifyCompletion() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await Notifications.scheduleNotificationAsync({
    content: {title: 'COMPASS', body: 'A project finished building.'},
    trigger: Platform.OS === 'android' ? {channelId: 'build-completion'} : null,
  });
}

export async function pickImage() {
  const result = await ImagePicker.launchImageLibraryAsync({mediaTypes: ['images'], quality: .82, allowsMultipleSelection: false});
  if (result.canceled) return null;
  const asset = result.assets[0];
  const mime = asset.mimeType;
  const file = new File(asset.uri);
  if ((mime !== 'image/jpeg' && mime !== 'image/png') || file.size > 524288) {
    throw Object.assign(new Error('invalid_asset'), {code: 'invalid_asset'});
  }
  const bytes = await file.bytes();
  if (bytes.length > 524288) throw Object.assign(new Error('invalid_asset'), {code: 'invalid_asset'});
  return {bytes: bytes.slice().buffer, mime} as const;
}
