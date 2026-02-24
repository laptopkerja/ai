import axios from 'axios'

async function main(){
  try{
    const r = await axios.get('http://localhost:3000/api/presets', { timeout: 2000 })
    console.log('SERVER OK', r.status)
  } catch(e){
    console.log('SERVER ERR', e.message || e.toString())
  }
}

main()
