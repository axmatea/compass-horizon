import React,{useState} from 'react';
import {View,Text,TextInput,Pressable,ScrollView,StyleSheet,StatusBar,KeyboardAvoidingView,Platform,useWindowDimensions} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import {TEMPLATE} from './template.mjs';
import {initialState,transition,progress,visibleItems,availableSlots,localDate,SERVICES} from './state.mjs';

const COPY = {
  pulse:{eyebrow:'YOUR DAILY RHYTHM',title:'Small steps.\nA better day.',subtitle:'A little space for the things that matter.',accent:'#d5f58b',tab:'Today',second:'Progress',add:'New habit',placeholder:'Name a habit',empty:'Your next habit starts here.',action:'Add habit'},
  field:{eyebrow:'MAKE ROOM FOR GOOD WORK',title:'A clear view.\nA focused team.',subtitle:'One place for the work ahead.',accent:'#bcdcff',tab:'Tasks',second:'Overview',add:'New task',placeholder:'What needs doing?',empty:'Nothing here. Make something good.',action:'Add task'},
  venue:{eyebrow:'A LITTLE MORE ROOM',title:'Meet here.\nMake it happen.',subtitle:'A simple space for your next session.',accent:'#ded1fa',tab:'Explore',second:'Requests',add:'Plan a visit',placeholder:'Guest name',empty:'Your requests will appear here.',action:'Save demo request'},
};
function Action({label,onPress,secondary=false,disabled=false}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({pressed})=>[styles.action,secondary&&styles.secondary,disabled&&styles.disabled,pressed&&styles.pressed]}><Text style={[styles.actionText,secondary&&styles.secondaryText]}>{label}</Text></Pressable>;
}
function Chip({label,selected,onPress}) {
  return <Pressable accessibilityRole="button" accessibilityState={{selected}} onPress={onPress} style={[styles.chip,selected&&styles.chipSelected]}><Text style={[styles.chipText,selected&&styles.chipTextSelected]}>{label}</Text></Pressable>;
}
function NativeTemplate() {
  const family = TEMPLATE.id,copy = COPY[family],{width} = useWindowDimensions();
  const [state,setState] = useState(()=>initialState(family)),[tab,setTab] = useState('main'),[label,setLabel] = useState(''),[filter,setFilter] = useState('all'),[priority,setPriority] = useState('normal'),[message,setMessage] = useState('');
  const [service,setService] = useState(SERVICES[0]),[date,setDate] = useState(localDate),[slot,setSlot] = useState('');
  const summary = progress(state),slots = availableSlots(state,date);
  function act(action) {
    const next = transition(state,action);
    setMessage(next.error || '');
    if (!next.error) setState(next.state);
    return !next.error;
  }
  function add() {
    if (family === 'venue') {
      if (act({type:'book',name:label,service,date,slot})) {setLabel('');setSlot('');setTab('details');setMessage('Demo request saved in this session. Nothing was sent.');}
    } else if (act({type:'add',label,priority})) setLabel('');
  }
  function records() {
    return state.bookings.length ? state.bookings.map(record=><View key={record.id} style={styles.record}>
      <Text style={styles.recordTitle}>{record.service}</Text><Text style={styles.body}>{record.name} · {record.date} · {record.slot}</Text>
      <View style={styles.recordFooter}><Text style={styles.caption}>{record.status === 'requested' ? 'Demo request' : 'Cancelled'}</Text>{record.status === 'requested'&&<Action secondary label={'Cancel '+record.service+' request'} onPress={()=>act({type:'cancel',id:record.id})}/>}</View>
    </View>) : <Text style={styles.empty}>{copy.empty}</Text>;
  }
  return <SafeAreaView style={styles.safe}><StatusBar barStyle="dark-content"/><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.page,width>760&&styles.wide]}>
      <View style={styles.header}><Text style={styles.brand}>{TEMPLATE.name}<Text style={styles.brandDot}>.</Text></Text><Text style={styles.headerLabel}>YOUR SPACE</Text></View>
      <View style={[styles.hero,{backgroundColor:copy.accent}]}><Text style={styles.eyebrow}>{copy.eyebrow}</Text><Text accessibilityRole="header" style={styles.title}>{copy.title}</Text><Text style={styles.subtitle}>{copy.subtitle}</Text>
        {family !== 'venue'&&<View style={styles.heroSummary}><Text style={styles.heroNumber}>{summary.done}<Text style={styles.heroTotal}> / {summary.total}</Text></Text><Text style={styles.heroLabel}>{family === 'pulse' ? 'habits completed' : 'tasks completed'}</Text></View>}
      </View>
      <View style={styles.tabs}><Chip label={copy.tab} selected={tab === 'main'} onPress={()=>{setTab('main');setMessage('');}}/><Chip label={copy.second} selected={tab === 'details'} onPress={()=>{setTab('details');setMessage('');}}/></View>
      {family === 'venue' ? tab === 'main' ? <View style={styles.panel}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{copy.add}</Text><Text style={styles.label}>Choose a session</Text><View style={styles.wrap}>{SERVICES.map(value=><Chip key={value} label={value} selected={service === value} onPress={()=>setService(value)}/>)}</View>
        <Text style={styles.label}>Guest</Text><TextInput accessibilityLabel="Guest name" value={label} onChangeText={setLabel} placeholder={copy.placeholder} placeholderTextColor="#777c78" maxLength={80} style={styles.input}/>
        <Text style={styles.label}>Date · YYYY-MM-DD</Text><TextInput accessibilityLabel="Visit date in YYYY-MM-DD format" value={date} onChangeText={value=>{setDate(value);setSlot('');}} placeholder="YYYY-MM-DD" placeholderTextColor="#777c78" maxLength={10} keyboardType="numbers-and-punctuation" style={styles.input}/>
        <Text style={styles.label}>Available times</Text><View style={styles.wrap}>{slots.length ? slots.map(value=><Chip key={value} label={value} selected={slot === value} onPress={()=>setSlot(value)}/>) : <Text style={styles.body}>No available times for this date.</Text>}</View>
        <Action label={copy.action} onPress={add}/><Text style={styles.caption}>Local demo records only. No real appointment is reserved.</Text>
      </View> : <View style={styles.panel}><Text accessibilityRole="header" style={styles.sectionTitle}>Your requests</Text>{records()}</View>
      : tab === 'details' ? <View style={styles.panel}><Text accessibilityRole="header" style={styles.sectionTitle}>{family === 'pulse' ? 'Today, at a glance.' : 'Work, in perspective.'}</Text>
        <Text style={styles.metric}>{summary.percent}<Text style={styles.metricUnit}>%</Text></Text><View style={styles.progressTrack}><View style={[styles.progressFill,{width:summary.percent+'%',backgroundColor:copy.accent}]}/></View>
        <Text style={styles.body}>{summary.done} completed · {summary.remaining} remaining</Text><Text style={styles.caption}>This view reflects the current session, with no invented streaks or team activity.</Text>
        <Action secondary label="Back to your list" onPress={()=>setTab('main')}/>
      </View> : <View style={styles.panel}>
        <View style={styles.sectionHeading}><Text accessibilityRole="header" style={styles.sectionTitle}>{family === 'pulse' ? 'Your habits' : 'Your tasks'}</Text><Text style={styles.caption}>{summary.remaining} left</Text></View>
        {family === 'field'&&<View style={styles.wrap}>{[['all','All'],['open','Open'],['done','Done']].map(([value,text])=><Chip key={value} label={text} selected={filter === value} onPress={()=>setFilter(value)}/>)}</View>}
        {visibleItems(state,family === 'field' ? filter : 'all').map(item=><View key={item.id} style={styles.item}>
          <Pressable accessibilityRole="checkbox" accessibilityState={{checked:item.done}} accessibilityLabel={item.label} onPress={()=>act({type:'toggle',id:item.id})} style={styles.itemMain}><View style={[styles.check,item.done&&{backgroundColor:copy.accent,borderColor:copy.accent}]}><Text style={styles.checkMark}>{item.done ? '✓' : ''}</Text></View><View style={styles.itemCopy}><Text style={[styles.itemTitle,item.done&&styles.completed]}>{item.label}</Text>{family === 'field'&&<Text style={styles.caption}>{item.priority === 'high' ? 'High priority' : 'Normal priority'}</Text>}</View></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={'Remove '+item.label} hitSlop={10} onPress={()=>act({type:'remove',id:item.id})} style={styles.remove}><Text style={styles.removeText}>×</Text></Pressable>
        </View>)}
        {!visibleItems(state,family === 'field' ? filter : 'all').length&&<Text style={styles.empty}>{copy.empty}</Text>}
        <View style={styles.composer}><Text style={styles.label}>{copy.add}</Text><TextInput accessibilityLabel={copy.add} value={label} onChangeText={setLabel} placeholder={copy.placeholder} placeholderTextColor="#777c78" maxLength={80} onSubmitEditing={add} style={styles.input}/>
          {family === 'field'&&<View style={styles.wrap}><Chip label="Normal priority" selected={priority === 'normal'} onPress={()=>setPriority('normal')}/><Chip label="High priority" selected={priority === 'high'} onPress={()=>setPriority('high')}/></View>}
          <Action label={copy.action} onPress={add}/></View>
      </View>}
      {!!message&&<Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>}
      <View style={styles.footer}><Text style={styles.caption}>Original editable starter · Session data resets on restart.</Text><Action secondary label="Reset demo data" onPress={()=>{act({type:'reset'});setMessage('Demo data reset.');}}/></View>
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}
export default function App() {return <SafeAreaProvider><NativeTemplate/></SafeAreaProvider>;}
const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#f7f8f6'},flex:{flex:1},page:{padding:24,paddingBottom:42,gap:24},wide:{width:760,alignSelf:'center'},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingVertical:6},brand:{fontSize:28,fontWeight:'800',letterSpacing:-1.4,color:'#161c17'},brandDot:{color:'#63816a'},headerLabel:{fontSize:11,fontWeight:'700',letterSpacing:2,color:'#70776f'},
  hero:{borderRadius:26,padding:28,gap:18},eyebrow:{fontSize:10,fontWeight:'800',letterSpacing:1.7,color:'#354235'},title:{fontSize:42,lineHeight:45,fontWeight:'700',letterSpacing:-1.9,color:'#182018'},subtitle:{fontSize:16,lineHeight:24,color:'#354235',maxWidth:420},
  heroSummary:{borderTopWidth:1,borderColor:'#18201820',paddingTop:18,flexDirection:'row',alignItems:'center',gap:16},heroNumber:{fontSize:42,fontWeight:'700',letterSpacing:-1.8,color:'#182018'},heroTotal:{fontSize:24,fontWeight:'400'},heroLabel:{fontSize:13,color:'#354235'},
  tabs:{flexDirection:'row',gap:8},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:8},chip:{paddingVertical:12,paddingHorizontal:17,borderRadius:24,borderWidth:1,borderColor:'#dce0d9',backgroundColor:'#fff'},chipSelected:{backgroundColor:'#1e2820',borderColor:'#1e2820'},chipText:{fontSize:13,fontWeight:'500',color:'#49534a'},chipTextSelected:{color:'#fff'},
  panel:{padding:22,borderRadius:22,backgroundColor:'#fff',gap:16,borderWidth:1,borderColor:'#eaede7'},sectionHeading:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:10},sectionTitle:{fontSize:22,fontWeight:'600',letterSpacing:-.6,color:'#1e2820'},
  item:{flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderColor:'#edf0e9',paddingVertical:12,gap:12},itemMain:{flexDirection:'row',alignItems:'center',gap:13,flex:1,minHeight:44},itemCopy:{flex:1,gap:5},itemTitle:{fontSize:16,lineHeight:23,color:'#263027'},completed:{color:'#838b81',textDecorationLine:'line-through'},
  check:{width:27,height:27,borderWidth:1.5,borderColor:'#ced6c8',borderRadius:9,alignItems:'center',justifyContent:'center'},checkMark:{color:'#243021',fontSize:17,fontWeight:'700'},remove:{width:36,height:40,alignItems:'center',justifyContent:'center'},removeText:{color:'#818a7c',fontSize:24},
  composer:{gap:12,paddingTop:12},label:{fontSize:13,fontWeight:'600',color:'#485143'},input:{minHeight:52,borderRadius:12,borderWidth:1,borderColor:'#dfe5d9',paddingHorizontal:15,paddingVertical:12,fontSize:16,color:'#19251b',backgroundColor:'#fbfcf9'},
  action:{minHeight:48,paddingVertical:13,paddingHorizontal:18,borderRadius:12,backgroundColor:'#1e2820',alignItems:'center',justifyContent:'center'},actionText:{fontSize:14,fontWeight:'600',color:'#fff'},secondary:{backgroundColor:'#eef1e9'},secondaryText:{color:'#485640'},disabled:{opacity:.4},pressed:{opacity:.75},
  body:{fontSize:15,lineHeight:23,color:'#5a6455'},caption:{fontSize:12,lineHeight:18,color:'#78816f'},empty:{fontSize:16,lineHeight:25,color:'#78816f',paddingVertical:20},metric:{fontSize:76,fontWeight:'600',letterSpacing:-5,color:'#1e2820'},metricUnit:{fontSize:32},progressTrack:{height:12,borderRadius:6,backgroundColor:'#edf0e9',overflow:'hidden'},progressFill:{height:12,borderRadius:6},
  record:{gap:10,paddingVertical:17,borderBottomWidth:1,borderColor:'#e8ecdf'},recordTitle:{fontSize:18,fontWeight:'600',color:'#263027'},recordFooter:{gap:12},message:{fontSize:14,lineHeight:22,color:'#425b36',paddingHorizontal:4},footer:{gap:16,alignItems:'center'},
});
