import {createContext, useContext, type ReactNode} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View, type TextInputProps} from 'react-native';

export type Palette = {background: string; paper: string; text: string; muted: string; border: string; accent: string;
  accentBackground: string; onAccent: string; dangerous: string; dark: boolean};

const accents: Record<string, readonly [string, string]> = {
  indigo: ['#4435af','#b6a7ff'], blue: ['#2454ab','#a8c7ff'], slate: ['#385169','#b4cee0'],
  amber: ['#865116','#ffc772'], rose: ['#a63558','#ffafc7'],
};

export function palette(dark: boolean, accentName: string): Palette {
  const accent = (accents[accentName] || accents.indigo)[dark ? 1 : 0];
  return dark
    ? {background: '#15161b', paper: '#1f2026', text: '#f7f7fa', muted: '#aaaab5', border: '#383942', accent,
      accentBackground: accent + '25', onAccent: '#191827', dangerous: '#ffb4ab', dark}
    : {background: '#f7f7fa', paper: '#ffffff', text: '#1b1b24', muted: '#5c5d6d', border: '#e3e3eb', accent,
      accentBackground: accent + '12', onAccent: '#ffffff', dangerous: '#a62424', dark};
}

export const PaletteContext = createContext(palette(false, 'indigo'));
export const usePalette = () => useContext(PaletteContext);

export const styles = StyleSheet.create({
  page: {flex: 1},
  max: {maxWidth: 760, width: '100%', alignSelf: 'center'},
  content: {paddingHorizontal: 18, paddingTop: 22, paddingBottom: 34, gap: 16},
  brand: {paddingHorizontal: 18, paddingTop: 10, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8},
  mark: {width: 9, height: 9, borderRadius: 3, transform: [{rotate: '45deg'}]},
  brandText: {fontSize: 14, fontWeight: '700', letterSpacing: 0.1},
  header: {gap: 7, marginBottom: 4},
  title: {fontSize: 35, fontWeight: '700', letterSpacing: -1.4},
  heading: {fontSize: 19, fontWeight: '700', letterSpacing: -0.25},
  body: {fontSize: 15, lineHeight: 21},
  label: {fontSize: 14, fontWeight: '600'},
  card: {padding: 15, borderRadius: 16, borderWidth: 1, gap: 8, flexGrow: 1},
  cards: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  metric: {fontSize: 24, fontWeight: '700', letterSpacing: -0.7},
  row: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8},
  rowSpread: {justifyContent: 'space-between'},
  action: {minHeight: 44, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1},
  actionText: {fontSize: 14, fontWeight: '700'},
  hint: {minHeight: 48, borderRadius: 13, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 10, gap: 6},
  field: {gap: 7},
  input: {borderWidth: 1, borderRadius: 11, minHeight: 48, fontSize: 16, paddingHorizontal: 11, paddingVertical: 9},
  multiline: {minHeight: 79, textAlignVertical: 'top'},
  nav: {flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 6, borderTopWidth: 1},
  navItem: {flex: 1, minHeight: 50, justifyContent: 'center', alignItems: 'center', gap: 3, paddingHorizontal: 2, paddingVertical: 6},
  navBar: {width: 15, height: 3, borderRadius: 2},
  navText: {fontSize: 12, fontWeight: '600', textAlign: 'center'},
});

export function Button({label, accessibilityLabel, onPress, kind = 'plain', disabled = false, selected = false, testID}: {
  label: string; accessibilityLabel?: string; onPress: () => void; kind?: 'plain'|'primary'|'danger'; disabled?: boolean; selected?: boolean; testID?: string;
}) {
  const colors = usePalette();
  const primary = kind === 'primary';
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{disabled, selected}} testID={testID} disabled={disabled} onPress={onPress}
    style={({pressed}) => [styles.action, {
      backgroundColor: primary ? colors.accent : selected ? colors.accentBackground : colors.paper,
      borderColor: primary || selected ? colors.accent : colors.border,
      opacity: disabled ? 0.58 : pressed ? 0.75 : 1,
    }]}>
    <Text style={[styles.actionText, {color: primary ? colors.onAccent : kind === 'danger' ? colors.dangerous : selected ? colors.accent : colors.text}]}>
      {label}
    </Text>
  </Pressable>;
}

export function ScreenHeading({title, subtitle}: {title: string; subtitle?: string}) {
  const colors = usePalette();
  return <View style={styles.header}>
    <Text accessibilityRole="header" style={[styles.title, {color: colors.text}]}>{title}</Text>
    {subtitle ? <Text style={[styles.body, {color: colors.muted}]}>{subtitle}</Text> : null}
  </View>;
}

export function Card({children, minWidth}: {children: ReactNode; minWidth?: number}) {
  const {paper, border} = usePalette();
  return <View style={[styles.card, {backgroundColor: paper, borderColor: border, minWidth}]}>{children}</View>;
}

export function Name({children}: {children: ReactNode}) {
  const {text} = usePalette();
  return <Text style={[styles.heading, {color: text}]}>{children}</Text>;
}

export function Detail({children}: {children: ReactNode}) {
  const {muted} = usePalette();
  return <Text style={[styles.body, {color: muted}]}>{children}</Text>;
}

export function Field({label, ...props}: TextInputProps & {label: string}) {
  const colors = usePalette();
  return <View style={styles.field}>
    <Text style={[styles.label, {color: colors.text}]}>{label}</Text>
    <TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} {...props}
      style={[styles.input, props.multiline && styles.multiline, {color: colors.text, backgroundColor: colors.paper, borderColor: colors.border}]}/>
  </View>;
}

export function Feedback({message, error = false}: {message: string; error?: boolean}) {
  const colors = usePalette();
  return <Text accessibilityRole={error ? 'alert' : undefined} accessibilityLiveRegion="polite"
    style={[styles.hint, styles.body, {color: error ? colors.dangerous : colors.accent, backgroundColor: colors.paper, borderColor: colors.border}]}>
    {message}
  </Text>;
}
