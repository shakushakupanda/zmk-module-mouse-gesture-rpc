from pathlib import Path
import re, subprocess, tempfile
root=Path(__file__).resolve().parent.parent
scratch=Path(tempfile.mkdtemp(prefix='mg-smooth-test-'))
header=(root/'src/input_processors/inertial_scroll.h').read_text()
src=(root/'src/input_processors/input_processor_inertial_scroll.c').read_text()
src=re.sub(r'^#(?:include|pragma).*\n','',header+'\n'+src,flags=re.M)
pre=r'''
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include <string.h>
#include <errno.h>
#include <assert.h>
#include <stdio.h>
#define MIN(a,b) ((a)<(b)?(a):(b))
#define MAX(a,b) ((a)>(b)?(a):(b))
#define CLAMP(v,a,b) MIN(MAX(v,a),b)
#define BIT(n) (1U<<(n))
#define ARG_UNUSED(x) (void)(x)
#define CONTAINER_OF(p,t,m) ((t *)((char *)(p)-offsetof(t,m)))
#define INPUT_REL_WHEEL 8
#define INPUT_REL_HWHEEL 6
#define INPUT_REL_X 0
#define INPUT_REL_Y 1
#define INPUT_EV_REL 2
#define ZMK_INPUT_PROC_CONTINUE 0
#define ZMK_EV_EVENT_BUBBLE 0
#define ZMK_LISTENER(a,b)
#define ZMK_SUBSCRIPTION(a,b)
#define K_MSEC(x) (x)
#define K_NO_WAIT 0
#define DT_INST_FOREACH_STATUS_OKAY(x)
typedef int zmk_event_t;
struct device {void *data; const void *config;};
struct input_event {const struct device *dev;uint16_t type,code;int32_t value;bool sync;};
struct zmk_input_processor_state {int unused;};
struct zmk_input_processor_driver_api {int (*handle_event)(const struct device *,struct input_event *,uint32_t,uint32_t,struct zmk_input_processor_state *);};
struct k_work {int unused;};
struct k_work_delayable {struct k_work work;};
struct k_spinlock {int unused;};
typedef int k_spinlock_key_t;
static int64_t clock_ms,deadline;
static bool scheduled;
static uint32_t layers=BIT(6);
static int k_spin_lock(struct k_spinlock*l){(void)l;return 0;}
static void k_spin_unlock(struct k_spinlock*l,int k){(void)l;(void)k;}
static int64_t k_uptime_get(void){return clock_ms;}
static bool zmk_keymap_layer_active(uint8_t layer){return (layers&BIT(layer))!=0;}
static void k_work_init_delayable(struct k_work_delayable*w,void(*cb)(struct k_work*)){(void)w;(void)cb;}
static struct k_work_delayable *k_work_delayable_from_work(struct k_work*w){return CONTAINER_OF(w,struct k_work_delayable,work);}
static int k_work_reschedule(struct k_work_delayable*w,int64_t dt){(void)w;scheduled=true;deadline=clock_ms+dt;return 0;}
static int k_work_cancel_delayable(struct k_work_delayable*w){(void)w;scheduled=false;return 0;}
static struct input_event queued[256];static int qn;
static int input_report_rel(const struct device*dev,uint16_t code,int32_t value,bool sync,int timeout){(void)timeout;assert(qn<256);queued[qn++]=(struct input_event){dev,INPUT_EV_REL,code,value,sync};return 0;}
'''
post=r'''
static struct inertial_scroll_data d;
static struct inertial_scroll_config cfg={60,BIT(6)|BIT(7)};
static struct device dev={&d,&cfg},sensor;
static int totals[2],reports;static int64_t last_output;
static void record(struct input_event e){int i=code_index(e.code);if(i>=0&&e.value){assert(e.value>=-4&&e.value<=4);totals[i]+=e.value;reports++;last_output=clock_ms;}}
static void flush(void){for(int i=0;i<qn;i++){struct input_event e=queued[i];inertial_scroll_driver_api.handle_event(&dev,&e,0,0,NULL);record(e);}qn=0;}
static void reset(bool enabled){memset(&d,0,sizeof d);g_inertial_scroll_data=NULL;clock_ms=1000;scheduled=false;capture_end=0;qn=0;totals[0]=totals[1]=reports=0;last_output=clock_ms;layers=BIT(6);inertial_scroll_init(&dev);struct zmk_inertial_scroll_settings s={enabled,20,40,85,100,64,20,80,4,40};assert(zmk_inertial_scroll_runtime_set(&s)==0);}
static void until(int64_t target){int guard=0;while(scheduled&&deadline<=target){assert(++guard<2000);clock_ms=deadline;scheduled=false;inertial_scroll_work_cb(&d.work.work);flush();}clock_ms=target;}
static void input(int dt,int code,int value){until(clock_ms+dt);struct input_event e={&sensor,INPUT_EV_REL,code,value,true};inertial_scroll_driver_api.handle_event(&dev,&e,0,0,NULL);if(code==INPUT_REL_X)assert(e.value==value);else record(e);}
static void drain(void){until(clock_ms+2500);assert(!scheduled);}
static void flick(void){for(int i=0;i<4;i++)input(10,8,60);}
int main(void){
 reset(false);input(0,8,240);assert(totals[0]==1);until(clock_ms+8);assert(totals[0]>1&&totals[0]<4);drain();assert(totals[0]==4);
 reset(false);for(int i=0;i<60;i++)input(1,8,1);drain();assert(totals[0]==1); // raw sub-step travel conserved
 reset(false);for(int i=0;i<60;i++)input(1,6,-1);drain();assert(totals[1]==-1);
 reset(true);for(int i=0;i<20;i++)input(100,8,60);drain();assert(totals[0]==20); // ordinary motion never adds inertia
 reset(true);input(0,8,240);drain();assert(totals[0]==4); // single large report isn't a flick
 reset(true);flick();assert(d.armed);int64_t stop=clock_ms;drain();assert(totals[0]>4);printf("Flick: %d steps, motion ended within %lld ms\n",totals[0],(long long)(last_output-stop));
 reset(true);flick();layers=0;layer_changed(NULL);int before=totals[0];drain();assert(totals[0]==before);
 reset(true);flick();layers|=BIT(2);layer_changed(NULL);assert(d.armed); // unrelated layer doesn't brake
 reset(true);flick();input(1,INPUT_REL_X,3);before=totals[0];drain();assert(totals[0]==before);
 reset(true);flick();input(1,8,-60);before=totals[0];drain();assert(totals[0]==before); // reversal clears old tail
 reset(false);input(0,8,240);clock_ms=deadline;scheduled=false;inertial_scroll_work_cb(&d.work.work);assert(qn);layers=0;layer_changed(NULL);layers=BIT(6);before=totals[0];flush();assert(totals[0]==before); // stale queued frame rejected even after re-entry
 reset(true);flick();until(clock_ms+48);input(1,8,60);before=totals[0];drain();assert(totals[0]==before); // manual brake
 reset(true);flick();until(clock_ms+40);clock_ms+=100;scheduled=false;inertial_scroll_work_cb(&d.work.work);flush();assert(!scheduled); // no catch-up burst after a stalled worker
 reset(true);struct mg_scroll_capture cap;assert(mg_scroll_capture_read(1,0,0,&cap)==0);uint32_t id=cap.id;for(int i=0;i<6;i++)input(5,8,20);assert(mg_scroll_capture_read(2,id,0,&cap)==0);assert(cap.count==2&&cap.samples[0].value==1&&cap.samples[1].value==1&&totals[0]==2); // capture keeps old step units
 reset(false);input(0,8,INT32_MIN);drain();assert(totals[0]<0&&totals[0]>=-65);
 reset(true);for(int i=0;i<4;i++)input(10,6,-60);drain();assert(totals[1]<-4&&totals[0]==0);
 reset(false);for(int i=0;i<400;i++)input(2,8,7);drain();assert(totals[0]==2800/60); // long fractional stream
 reset(true);struct zmk_inertial_scroll_settings s=d.settings;s.tick_ms=1;s.decay_percent=99;s.min_velocity_q8=1;s.max_ticks=255;zmk_inertial_scroll_runtime_set(&s);flick();drain();
 reset(false);struct scroll_axis a={.velocity=Q_ONE};s=d.settings;s.decay_percent=50;int32_t whole=advance_velocity(&a,20,&s);assert(whole==3*Q_ONE/4&&a.velocity==Q_ONE/2);a=(struct scroll_axis){.velocity=Q_ONE};int32_t pieces=advance_velocity(&a,8,&s)+advance_velocity(&a,8,&s)+advance_velocity(&a,4,&s);assert(magnitude(whole-pieces)<=3);
 puts("PASS: onset, burst spreading, raw fractions, speed gating, reversal, layer and pointer brake, stale queue, worker stall, capture units, numeric bounds");
}
'''
(scratch/'test.c').write_text(pre+src+post)
subprocess.run(['cc','-std=c11','-Wall','-Wextra','-Werror','-fsanitize=address,undefined',str(scratch/'test.c'),'-o',str(scratch/'test')],check=True)
subprocess.run([str(scratch/'test')],check=True)
