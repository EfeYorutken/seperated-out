import { gql } from '@apollo/client'
import { useQuery } from '@apollo/client/react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { useMemo } from 'react'

import { colors_for, line_key } from './colors'

type Point = { at: string; total: number }

type Series = {
  profile_id: number
  profile_name: string
  points: Point[]
}

type OverTime = {
  bucket_ms: number
  crawl_interval_ms: number
  generated_at: string
  series: Series[]
}

const positions_over_time_q = gql`

  query positions_over_time{
    positions_over_time{
      bucket_ms
      crawl_interval_ms
      generated_at
      series{
        profile_id
        profile_name
        points{ at total }
      }
    }
  }

`

//the crawler runs on its own schedule, polling is how the graph learns about it
const POLL_MS = 30_000

const describe_width = ( ms: number ) => {

  const seconds = ms / 1000
  if(seconds < 60){ return `${seconds}s` }
  if(seconds < 3600){ return `${Math.round(seconds / 60)}m` }
  if(seconds < 86400){ return `${Math.round(seconds / 3600)}h` }
  return `${Math.round(seconds / 86400)}d`

}

const time_label = ( stamp: number, width_ms: number ) => {

  const at = new Date(stamp)

  if(width_ms < 60_000){
    return at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
  if(width_ms < 86_400_000){
    return at.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return at.toLocaleDateString([], { month: 'short', day: 'numeric' })

}

type Row = Record<string, string | number>

const Graph = () => {

  const { loading, error, data } = useQuery<{ positions_over_time: OverTime | null }>(
    positions_over_time_q,
    { pollInterval: POLL_MS }
  )

  //apollo masks every field of the generic as optional because without codegen
  //it cannot know which ones the schema marks nullable, so the shape is
  //restated once here instead of guarding on each field below
  const graph = (data as { positions_over_time: OverTime | null } | undefined)
    ?.positions_over_time ?? null

  const series = useMemo(() => graph?.series ?? [], [graph])

  //names can repeat but ids cannot, so a line is keyed off the id
  const colors = useMemo(
    () => colors_for(series.map((s) => ({ profile_id: s.profile_id, profile_name: s.profile_name }))),
    [series]
  )

  const rows = useMemo<Row[]>(() => {

    const longest = series.reduce((most, s) => Math.max(most, s.points.length), 0)

    const out: Row[] = []
    for(let i = 0; i < longest; i++){
      const row: Row = { stamp: NaN, label: '' }
      for(const s of series){
        const point = s.points[i]
        row[line_key(s.profile_id)] = point ? point.total : 0
        if(point){ row.stamp = Date.parse(point.at) }
      }
      out.push(row)
    }
    return out

  }, [series])

  if(loading){ return (<div className="graph borderable">Loading..</div>) }

  if(error){
    console.error(`[GRAPH ERROR] ${error}`)
    return (<div className="graph borderable">Woops<br/> something went wrong:(</div>)
  }

  if(!graph){
    return (<div className="graph borderable">nothing to plot yet</div>)
  }

  if(!series.length){
    return (
      <div className="graph borderable">
        <h1>positions over time</h1>
        <p>no profiles yet, make one and the graph fills itself in</p>
      </div>
    )
  }

  const has_a_finding = rows.some((row) =>
    series.some((s) => Number(row[line_key(s.profile_id)] || 0) > 0)
  )

  return (

    <div className="graph borderable">

      <div className="graph_header">
        <h1>positions over time</h1>
        <span className="graph_meta">
          one point per {describe_width(graph.bucket_ms)}
          { graph.bucket_ms !== graph.crawl_interval_ms
            ? ` (crawling every ${describe_width(graph.crawl_interval_ms)}, widened to stay readable)`
            : '' }
        </span>
      </div>

      { !has_a_finding &&
        <p className="graph_empty">no positions found yet, the lines will climb as crawls succeed</p>
      }

      <div className="graph_plot">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#dddddd" />
            <XAxis
              dataKey="stamp"
              type="number"
              domain={['dataMin', 'dataMax']}
              scale="time"
              tickFormatter={(value) => time_label(Number(value), graph.bucket_ms)}
              stroke="#888888"
              fontSize={11}
              minTickGap={40}
            />
            <YAxis
              allowDecimals={false}
              stroke="#888888"
              fontSize={11}
              width={44}
              label={{ value: 'positions', angle: -90, position: 'insideLeft', fontSize: 11 }}
            />
            <Tooltip
              labelFormatter={(value) => time_label(Number(value), graph.bucket_ms)}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {
              series.map((s) => (
                <Line
                  key={s.profile_id}
                  type="monotone"
                  dataKey={line_key(s.profile_id)}
                  name={s.profile_name}
                  stroke={colors.get(s.profile_id)}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))
            }
          </LineChart>
        </ResponsiveContainer>
      </div>

      <ul className="graph_totals">
        {
          series.map((s) => {
            const last = s.points[s.points.length - 1]
            return (
              <li key={s.profile_id}>
                <span className="swatch" style={{ background: colors.get(s.profile_id) }} />
                {s.profile_name}
                <b>{ last ? last.total : 0 }</b>
              </li>
            )
          })
        }
      </ul>

    </div>

  )

}

export default Graph
