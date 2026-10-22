import { router } from 'expo-router';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type TextInput } from 'react-native';

import { ArticuloDetalle } from '@/components/abasto/articulo-detalle';
import { BarraBusqueda, EncabezadoBusqueda, Grupo, Renglon, useRecientes } from '@/components/abasto/busqueda';
import { RejillaArticulos, Resaltado, Vacio } from '@/components/abasto/catalogo';
import { MapaRegiones, useColoresRegion } from '@/components/abasto/mapa';
import { Barras, EstadoDatos, Icono, Kpi, Tarjeta, s as ui } from '@/components/abasto/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { REGIONES, SIGLAS, contar, dinero, entero, nArt, sinAcentos, type Articulo } from '@/data/abasto';
import { NAL, useAbasto } from '@/data/abasto-context';
import { buscarRegiones, filtrarArticulos, palabras } from '@/data/busqueda';
import { useTheme } from '@/hooks/use-theme';

const N_UNIDADES = SIGLAS.reduce((n, s) => n + REGIONES[s].unidades.length, 0);

export default function Regiones() {
  const t = useTheme();
  const colores = useColoresRegion();
  const { datos, cargando, actualizar, region, setRegion, setFiltrosArticulos } = useAbasto();
  const [prodSel, setProdSel] = useState<{ region: string | null; prod: string } | null>(null);
  const [todosProd, setTodosProd] = useState(false);
  const [sel, setSel] = useState<Articulo | null>(null);
  // Búsqueda: mientras se escribe se muestra el panel de resultados; «textoArt» filtra los artículos de la región
  const { recientes, agregar, borrar } = useRecientes('busquedas-regiones:v1');
  const input = useRef<TextInput>(null);
  const [enfocado, setEnfocado] = useState(false);
  const [borrador, setBorrador] = useState('');
  const [textoArt, setTextoArt] = useState('');
  const consulta = useDeferredValue(borrador);

  const arts = useMemo(() => datos?.articulos ?? [], [datos]);
  const regional = useMemo(() => arts.filter((a) => a.alcance === 'Regional'), [arts]);

  const dReg = useMemo(() => {
    if (region === NAL) return arts.filter((a) => a.alcance === 'Nacional');
    return region ? regional.filter((a) => a.regiones.includes(region)) : regional;
  }, [arts, regional, region]);
  const productos = useMemo(() => contar(dReg, (a) => a.prod, (a) => a.producto), [dReg]);
  // El producto elegido es de la región elegida; al cambiar de región se olvida
  const prod = prodSel && prodSel.region === region ? prodSel.prod : null;
  const lista = useMemo(
    () => {
      const base = prod ? dReg.filter((a) => a.prod === prod) : dReg;
      // Con búsqueda, por relevancia; sin ella, por producto y nombre. Un artículo en varias negociaciones sale
      // una vez (su ficha muestra todas)
      if (textoArt) return filtrarArticulos(base, { texto: textoArt });
      const vistos = new Set<string>();
      return base
        .slice()
        .sort((x, y) => x.producto.localeCompare(y.producto) || x.articulo.localeCompare(y.articulo))
        .filter((a) => !vistos.has(a.artId) && vistos.add(a.artId));
    },
    [dReg, prod, textoArt],
  );

  const resultados = useMemo(() => {
    const ps = palabras(consulta);
    if (!enfocado || !ps.length) return null;
    return {
      regiones: buscarRegiones(consulta),
      productos: productos.filter((p) => ps.every((w) => sinAcentos(p.etiqueta).includes(w))).slice(0, 5),
      articulos: filtrarArticulos(dReg, { texto: consulta }).slice(0, 6),
    };
  }, [consulta, enfocado, productos, dReg]);

  const elegir = (sig: string) => {
    setRegion(region === sig ? null : sig);
    setTodosProd(false);
    setTextoArt('');
  };
  const salir = () => {
    setEnfocado(false);
    Keyboard.dismiss();
  };
  const buscarArticulos = (q: string) => {
    agregar(q);
    setTextoArt(q.trim());
    salir();
  };
  const tipo = region === NAL ? 'nacionales' : 'regionales';
  const nombreReg = region === NAL ? 'Nacional' : region ? `${region} · ${REGIONES[region].nombre}` : 'Todo el país';
  const nombreProd = prod ? productos.find((p) => p.clave === prod)?.etiqueta : null;

  return (
    <View style={[styles.fondo, { backgroundColor: t.background }]}>
      <EncabezadoBusqueda titulo="Regiones">
        <BarraBusqueda
          inputRef={input}
          valor={enfocado ? borrador : textoArt}
          onCambiar={(v) => (enfocado ? setBorrador(v) : setTextoArt(v))}
          onFoco={() => {
            setBorrador(textoArt);
            setEnfocado(true);
          }}
          onEnviar={() => buscarArticulos(borrador)}
          placeholder="Región, estado, unidad o artículo"
          activo={enfocado}
          onCancelar={salir}
        />
      </EncabezadoBusqueda>

      {enfocado ? (
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.panel}>
          {!resultados ? (
            recientes.length ? (
              <Grupo titulo="Búsquedas recientes" accion="Borrar" onAccion={borrar}>
                {recientes.map((q) => (
                  <Renglon key={q} icono="reciente" onPress={() => buscarArticulos(q)} onCompletar={() => {
                    setBorrador(q);
                    input.current?.focus();
                  }}>
                    <Text style={[styles.renglonTexto, { color: t.text }]} numberOfLines={1}>{q}</Text>
                  </Renglon>
                ))}
              </Grupo>
            ) : (
              <Text style={[styles.ayuda, { color: t.muted }]}>
                Busque una gerencia regional, un estado o una unidad operativa (por ejemplo «Chiapas» o «Tapachula»), o un
                producto o artículo de {region ? nombreReg : 'las regiones'}.
              </Text>
            )
          ) : (
            <>
              <Renglon icono="buscar" onPress={() => buscarArticulos(borrador)}>
                <Text style={[styles.renglonTexto, { color: t.text }]} numberOfLines={2}>
                  Buscar «<Text style={{ fontWeight: '700' }}>{borrador.trim()}</Text>» en artículos {tipo} de {nombreReg}
                </Text>
              </Renglon>
              {resultados.regiones.length ? (
                <Grupo titulo="Regiones">
                  {resultados.regiones.map(({ sig, por }) => (
                    <Renglon key={sig} icono="ubicacion" extra={sig === NAL ? 'todo el país' : `clave ${REGIONES[sig].clave}`}
                      onPress={() => {
                        agregar(borrador);
                        setRegion(sig);
                        setTextoArt('');
                        setTodosProd(false);
                        salir();
                      }}>
                      <View style={styles.regionFila}>
                        <Text style={[styles.sigla, { backgroundColor: sig === NAL ? '#111111' : colores[sig] }]}>{sig}</Text>
                        <Resaltado texto={sig === NAL ? 'Nacional' : REGIONES[sig].nombre} consulta={borrador}
                          style={[styles.renglonTexto, { color: t.text }]} numberOfLines={1} />
                      </View>
                      {por ? <Resaltado texto={`Incluye ${por}`} consulta={borrador} style={[styles.renglonSub, { color: t.muted }]} /> : null}
                    </Renglon>
                  ))}
                </Grupo>
              ) : null}
              {resultados.productos.length ? (
                <Grupo titulo={`Productos ${tipo} · ${nombreReg}`}>
                  {resultados.productos.map((p) => (
                    <Renglon key={p.clave} icono="producto" extra={`${entero(p.valor)} art.`} onPress={() => {
                      agregar(borrador);
                      setProdSel({ region, prod: p.clave });
                      setTextoArt('');
                      salir();
                    }}>
                      <Resaltado texto={p.etiqueta} consulta={borrador} style={[styles.renglonTexto, { color: t.text }]} numberOfLines={1} />
                    </Renglon>
                  ))}
                </Grupo>
              ) : null}
              {resultados.articulos.length ? (
                <Grupo titulo={`Artículos ${tipo} · ${nombreReg}`}>
                  {resultados.articulos.map((a) => (
                    <Renglon key={a.artId} icono="articulo" extra={dinero(a.costoUnit)} onPress={() => {
                      agregar(borrador);
                      salir();
                      setSel(a);
                    }}>
                      <Resaltado texto={a.articulo} consulta={borrador} style={[styles.renglonTexto, { color: t.text }]} numberOfLines={1} />
                      <Text style={[styles.renglonSub, { color: t.muted }]} numberOfLines={1}>{a.marca} · {a.presentacion}</Text>
                    </Renglon>
                  ))}
                </Grupo>
              ) : null}
              {!resultados.regiones.length && !resultados.productos.length && !resultados.articulos.length ? (
                <Text style={[styles.ayuda, { color: t.muted }]}>
                  Sin coincidencias para «{borrador.trim()}» en {nombreReg}.{region ? ' Quite la región elegida para buscar en todas.' : ''}
                </Text>
              ) : null}
            </>
          )}
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.cuerpo}
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={cargando} onRefresh={actualizar} tintColor={t.accent} colors={[t.accent]} />}>
          <EstadoDatos />
          <Tarjeta titulo="Mapa de gerencias regionales"
            sub={`${SIGLAS.length} gerencias y ${N_UNIDADES} unidades operativas. Toca un estado para elegir su región; tócalo otra vez para ver todas.`}>
            <MapaRegiones seleccion={region} onElegir={elegir} />
          </Tarjeta>

          <View style={styles.rejilla}>
            {SIGLAS.map((sig) => (
              <CajaRegion key={sig} sig={sig} color={colores[sig]} nombre={REGIONES[sig].nombre} detalle={`clave ${REGIONES[sig].clave}`}
                unidades={REGIONES[sig].unidades.join(' · ')} activa={region === sig} onPress={() => elegir(sig)} />
            ))}
            {/* Nacional al final, después de la última gerencia (Puebla) */}
            <CajaRegion sig={NAL} color="#111111" nombre="Nacional" detalle="todo el país"
              unidades={`Llega a las ${SIGLAS.length} regiones y sus ${N_UNIDADES} unidades operativas`}
              activa={region === NAL} onPress={() => elegir(NAL)} />
          </View>

          {region ? (
            <Pressable onPress={() => setRegion(null)} style={({ pressed }) => [styles.quitar, { backgroundColor: t.accentSoft }, pressed && ui.presionado]}>
              <Text style={[styles.quitarTexto, { color: t.accent }]}>Viendo: {nombreReg}</Text>
              <Icono nombre="cerrar" color={t.accent} tam={12} />
            </Pressable>
          ) : null}

          <View style={styles.kpis}>
            <Kpi etiqueta={`Artículos ${tipo}`} valor={nArt(dReg)} icono="articulo" />
            <Kpi etiqueta="Productos" valor={productos.length} icono="producto" />
          </View>

          <Tarjeta titulo={`Productos ${tipo} · ${nombreReg}`} sub="Toca un producto para ver solo sus artículos." extra={`${productos.length} productos`}>
            {productos.length ? (
              <>
                <Barras items={todosProd ? productos : productos.slice(0, 10)} total={nArt(dReg)} color={region && region !== NAL ? colores[region] : t.green}
                  colores={prod ? Object.fromEntries(productos.map((p) => [p.clave, p.clave === prod ? t.accent : t.border])) : undefined}
                  onPress={(c) => setProdSel(prod === c.clave ? null : { region, prod: c.clave })} />
                {productos.length > 10 ? (
                  <Pressable onPress={() => setTodosProd(!todosProd)} hitSlop={8} style={{ marginTop: Spacing.three }}>
                    <Text style={[styles.mas, { color: t.accent }]}>{todosProd ? 'Ver menos' : `Ver los ${productos.length} productos`}</Text>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <Text style={{ color: t.muted }}>Esta región no tiene artículos regionales.</Text>
            )}
          </Tarjeta>

          <Tarjeta titulo={`Artículos ${tipo}${nombreProd ? ` · ${nombreProd}` : ''}`}
            sub={region === NAL ? 'Artículos con cobertura nacional: llegan a todas las regiones.'
              : 'Artículos con cobertura regional que llegan a esta región (los nacionales llegan a todas).'}
            extra={`${entero(nArt(lista))} art.`}>
            {textoArt ? (
              <Pressable onPress={() => setTextoArt('')}
                style={({ pressed }) => [styles.quitar, { backgroundColor: t.accentSoft, marginBottom: Spacing.three }, pressed && ui.presionado]}>
                <Text style={[styles.quitarTexto, { color: t.accent }]}>Búsqueda: «{textoArt}»</Text>
                <Icono nombre="cerrar" color={t.accent} tam={12} />
              </Pressable>
            ) : null}
            {lista.length ? (
              <RejillaArticulos key={`${region}-${prod}-${textoArt}`} articulos={lista} onPress={setSel} margen={Spacing.three * 2} />
            ) : (
              <Vacio titulo="Sin artículos" texto={textoArt ? `Nada coincide con «${textoArt}» en ${nombreReg}.` : undefined}
                accion={textoArt ? 'Quitar búsqueda' : undefined} onAccion={() => setTextoArt('')} />
            )}
          </Tarjeta>
        </ScrollView>
      )}

      <ArticuloDetalle
        articulo={sel}
        onClose={() => setSel(null)}
        onVerProveedor={(a) => {
          setSel(null);
          setFiltrosArticulos({ proveedor: a.cve });
          router.navigate('/articulos');
        }}
      />
    </View>
  );
}

function CajaRegion({ sig, color, nombre, detalle, unidades, activa, onPress }: {
  sig: string; color: string; nombre: string; detalle: string; unidades: string; activa: boolean; onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityState={{ selected: activa }}
      style={({ pressed }) => [
        styles.caja,
        { backgroundColor: activa ? t.accentSoft : t.backgroundElement, borderColor: activa ? t.accent : t.border },
        pressed && ui.presionado,
      ]}>
      <View style={styles.cajaH}>
        <Text style={[styles.sigla, { backgroundColor: color }]}>{sig}</Text>
        <Text style={[styles.cajaNombre, { color: t.text }]} numberOfLines={1}>{nombre}</Text>
      </View>
      <Text style={[styles.cajaDetalle, { color: t.muted }]}>{detalle}</Text>
      <Text style={[styles.cajaUnidades, { color: t.textSecondary }]} numberOfLines={3}>{unidades}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1 },
  cuerpo: { padding: Spacing.three, gap: Spacing.three, paddingBottom: BottomTabInset + Spacing.four, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  panel: { paddingBottom: BottomTabInset + Spacing.five, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  ayuda: { fontSize: 14, textAlign: 'center', padding: Spacing.five, lineHeight: 20 },
  renglonTexto: { fontSize: 15 },
  renglonSub: { fontSize: 12, marginTop: 2 },
  regionFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rejilla: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  caja: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderRadius: 10, padding: 10, gap: 2 },
  cajaH: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sigla: { color: '#fff', fontSize: 10, fontWeight: '700', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2, overflow: 'hidden' },
  cajaNombre: { flex: 1, fontSize: 13, fontWeight: '600' },
  cajaDetalle: { fontSize: 11 },
  cajaUnidades: { fontSize: 11, lineHeight: 15 },
  quitar: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  quitarTexto: { fontSize: 13, fontWeight: '600' },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  etq: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  mas: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
