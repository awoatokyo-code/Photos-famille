import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert, StatusBar } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as ML from 'expo-media-library';
import * as IM from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

const BASE = 'https://legendary-kulfi-4f9cc7.netlify.app';
let S = null, CFG = null;
const save = async s => { S = s; await AsyncStorage.setItem('s', JSON.stringify(s)); };
async function auth(p, b) { const r = await fetch(CFG.url + '/auth/v1/' + p, { method: 'POST', headers: { apikey: CFG.key, 'content-type': 'application/json' }, body: JSON.stringify(b) }); return r.json(); }
async function api(b, retry) {
  const r = await fetch(BASE + '/api', { method: 'POST', headers: { authorization: 'Bearer ' + S.access_token }, body: JSON.stringify(b) });
  if (r.status === 401 && !retry) { const d = await auth('token?grant_type=refresh_token', { refresh_token: S.refresh_token }); if (d.access_token) { await save(d); return api(b, 1); } }
  return r;
}
async function shrink(a) {
  const big = Math.max(a.width, a.height) > 2048, act = a.width >= a.height ? { width: 2048 } : { height: 2048 };
  try {
    if (IM.manipulateAsync) return (await IM.manipulateAsync(a.uri, big ? [{ resize: act }] : [], { compress: 0.82, format: IM.SaveFormat.JPEG })).uri;
    const c = IM.ImageManipulator.manipulate(a.uri); if (big) c.resize(act);
    return (await (await c.renderAsync()).saveAsync({ compress: 0.82, format: IM.SaveFormat.JPEG })).uri;
  } catch (e) { return a.uri; }
}
async function pool(arr, n, f) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < arr.length) { const j = i++; await f(arr[j], j); } })); }

async function backup(say) {
  const p = await ML.requestPermissionsAsync(); if (!p.granted) return say('Autorisation refusée');
  await activateKeepAwakeAsync();
  const done = new Set(JSON.parse((await AsyncStorage.getItem('done')) || '[]')); let after, total = 0;
  for (;;) {
    const pg = await ML.getAssetsAsync({ first: 40, after, mediaType: 'photo', sortBy: [[ML.SortBy.creationTime, false]] });
    total = pg.totalCount; const todo = pg.assets.filter(a => !done.has(a.id));
    if (todo.length) {
      const items = [];
      await pool(todo, 4, async a => { const u = await shrink(a); const b = await (await fetch(u)).blob(); items.push({ a, b }); });
      const r = await api({ a: 'sign', sizes: items.map(x => x.b.size), fps: items.map(x => 'a:' + x.a.id) }), j = await r.json();
      if (!r.ok) { say(j.error === 'quota' ? 'Espace plein : 100 Go atteints.' : 'Erreur d’envoi'); break; }
      await pool(items, 6, async (x, i) => { const u = await fetch(j.urls[i], { method: 'PUT', body: x.b }).catch(() => null); if (u && u.ok) done.add(x.a.id); say('Sauvegarde : ' + done.size + ' / ' + total); });
      await AsyncStorage.setItem('done', JSON.stringify([...done]));
    }
    if (!pg.hasNextPage) break; after = pg.endCursor;
  }
  deactivateKeepAwake(); say('Terminé : ' + done.size + ' photos sauvegardées');
}
async function purge(say) {
  const done = JSON.parse((await AsyncStorage.getItem('done')) || '[]');
  if (!done.length) return say('Rien à supprimer');
  Alert.alert('Supprimer du téléphone', done.length + ' photos sont bien sauvegardées. Les supprimer de ce téléphone ?', [{ text: 'Annuler' }, { text: 'Supprimer', style: 'destructive', onPress: async () => { for (let i = 0; i < done.length; i += 100) await ML.deleteAssetsAsync(done.slice(i, i + 100)); await AsyncStorage.setItem('done', '[]'); say('Photos supprimées du téléphone'); } }]);
}

const Glass = ({ children, style }) => <BlurView intensity={40} tint="dark" experimentalBlurMethod="dimezisBlurView" style={[st.g, style]}>{children}</BlurView>;
const Btn = ({ t, onPress, red }) => <Pressable onPress={onPress} style={{ marginTop: 12 }}><Glass style={red && { backgroundColor: '#e5484d55' }}><Text style={st.bt}>{t}</Text></Glass></Pressable>;

export default function App() {
  const [ready, setReady] = useState(false), [on, setOn] = useState(false), [name, setName] = useState(''), [pw, setPw] = useState(''), [msg, setMsg] = useState('');
  useEffect(() => { (async () => {
    try { CFG = await (await fetch(BASE + '/api')).json(); const s = await AsyncStorage.getItem('s');
      if (s) { S = JSON.parse(s); const r = await api({ a: 'join' }); if (r.ok) setOn(true); } } catch (e) { setMsg('Pas de connexion'); }
    setReady(true); })(); }, []);
  async function go(up) {
    const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (up) { const r = await fetch(BASE + '/api', { method: 'POST', body: JSON.stringify({ a: 'signup', name: n, password: pw }) }), j = await r.json();
      if (!r.ok) return setMsg(j.error === 'full' ? 'Les 3 places sont prises.' : j.error === 'exists' ? 'Ce prénom est déjà pris.' : 'Prénom : 2 lettres min. Mot de passe : 6 min.'); }
    const d = await auth('token?grant_type=password', { email: n + '@photos-famille.app', password: pw });
    if (!d.access_token) return setMsg('Prénom ou mot de passe incorrect');
    await save(d); const r = await api({ a: 'join' }); if (r.ok) { setMsg(''); setOn(true); }
  }
  return (
    <LinearGradient colors={['#0f1630', '#2a1b5e', '#0b3d4a']} style={st.f}>
      <StatusBar barStyle="light-content" />
      <View style={st.c}>
        <Text style={st.h}>Photos famille</Text>
        {!ready ? <Text style={st.m}>Chargement…</Text> : !on ? (<>
          <Glass><TextInput style={st.i} placeholder="Ton prénom" placeholderTextColor="#fff9" autoCapitalize="none" value={name} onChangeText={setName} /></Glass>
          <View style={{ height: 10 }} />
          <Glass><TextInput style={st.i} placeholder="Mot de passe" placeholderTextColor="#fff9" secureTextEntry value={pw} onChangeText={setPw} /></Glass>
          <Btn t="Se connecter" onPress={() => go(0)} /><Btn t="Créer mon compte" onPress={() => go(1)} />
        </>) : (<>
          <Btn t="Sauvegarder toute ma galerie" onPress={() => backup(setMsg)} />
          <Btn t="Supprimer du téléphone ce qui est sauvegardé" red onPress={() => purge(setMsg)} />
          <Btn t="Quitter" onPress={async () => { await AsyncStorage.removeItem('s'); S = null; setOn(false); }} />
        </>)}
        <Text style={st.m}>{msg}</Text>
      </View>
    </LinearGradient>
  );
}
const st = StyleSheet.create({
  f: { flex: 1 }, c: { flex: 1, justifyContent: 'center', padding: 24 },
  h: { color: '#fff', fontSize: 32, fontWeight: '800', marginBottom: 24 },
  g: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: '#ffffff40', backgroundColor: '#ffffff18' },
  bt: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center', padding: 16 },
  i: { color: '#fff', fontSize: 16, padding: 16 }, m: { color: '#fffc', marginTop: 18, textAlign: 'center' },
});
