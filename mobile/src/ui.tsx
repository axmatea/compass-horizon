import type {ReactNode} from 'react';
import {ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps} from 'react-native';

export const colors = {
  canvas: '#F7F8FC', white: '#FFFFFF', ink: '#111827', muted: '#475569', border: '#DCE1EE',
  accent: '#4235CA', accentTint: '#EDEAFF', green: '#116451', greenTint: '#E1FAF2',
  error: '#972133', errorTint: '#FFF0F2',
};

export const styles = StyleSheet.create({
  page: {paddingHorizontal: 20, paddingTop: 22, paddingBottom: 34, gap: 16, alignSelf: 'center', width: '100%', maxWidth: 670},
  heading: {fontSize: 36, lineHeight: 41, fontWeight: '800', color: colors.ink, letterSpacing: -1.5},
  section: {fontSize: 22, fontWeight: '700', color: colors.ink, letterSpacing: -.35},
  label: {fontSize: 15, fontWeight: '700', color: colors.ink},
  body: {fontSize: 16, lineHeight: 24, color: colors.ink},
  muted: {fontSize: 15, lineHeight: 22, color: colors.muted},
  small: {fontSize: 13, lineHeight: 18, color: colors.muted, fontWeight: '600'},
  card: {backgroundColor: colors.white, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 12},
  field: {gap: 6},
  input: {minHeight: 48, borderRadius: 13, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.white, color: colors.ink, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16},
  area: {minHeight: 105, textAlignVertical: 'top'},
  row: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8},
  spread: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8},
  divider: {height: StyleSheet.hairlineWidth, backgroundColor: colors.border},
  button: {minHeight: 48, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8},
  primary: {backgroundColor: colors.accent},
  secondary: {backgroundColor: colors.white, borderColor: colors.border, borderWidth: 1},
  active: {backgroundColor: colors.accentTint, borderColor: colors.accent, borderWidth: 1},
  primaryText: {color: colors.white, fontSize: 15, fontWeight: '700', textAlign: 'center'},
  secondaryText: {color: colors.ink, fontSize: 15, fontWeight: '700', textAlign: 'center'},
  pressed: {opacity: .72},
  disabled: {opacity: .55},
  notice: {borderRadius: 12, backgroundColor: colors.greenTint, padding: 10},
  noticeText: {color: colors.green, fontSize: 15, lineHeight: 21, fontWeight: '600'},
  error: {backgroundColor: colors.errorTint},
  errorText: {color: colors.error},
});

export function Button({label, onPress, primary = false, selected, disabled = false, busy = false}: {
  label: string; onPress: () => void; primary?: boolean; selected?: boolean; disabled?: boolean; busy?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled: disabled || busy, selected, busy}} disabled={disabled || busy}
    onPress={onPress} style={({pressed}) => [styles.button, primary ? styles.primary : selected ? styles.active : styles.secondary, (disabled || busy) && styles.disabled, pressed && styles.pressed]}>
    {busy && <ActivityIndicator color={primary ? colors.white : colors.accent} />}
    <Text style={primary ? styles.primaryText : styles.secondaryText}>{label}</Text>
  </Pressable>;
}

export function Field({label, multiline, ...props}: TextInputProps & {label: string}) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput {...props} accessibilityLabel={label} multiline={multiline} placeholderTextColor={colors.muted}
      style={[styles.input, multiline && styles.area]} />
  </View>;
}

export function Page({children, title, intro}: {children: ReactNode; title: string; intro?: string}) {
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
    <Text accessibilityRole="header" style={styles.heading}>{title}</Text>
    {intro && <Text style={styles.muted}>{intro}</Text>}
    {children}
  </ScrollView>;
}

export function Notice({message, error = false}: {message: string; error?: boolean}) {
  if (!message) return null;
  return <View accessibilityRole={error ? 'alert' : 'text'} accessibilityLiveRegion="polite" style={[styles.notice, error && styles.error]}>
    <Text style={[styles.noticeText, error && styles.errorText]}>{message}</Text>
  </View>;
}

export function Empty({text}: {text: string}) {
  return <View style={styles.card}><Text style={styles.muted}>{text}</Text></View>;
}
