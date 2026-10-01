from pathlib import Path
import re, subprocess
import tempfile
scratch=Path(tempfile.mkdtemp(prefix="mg-flick-test-"))
root=Path(__file__).resolve().parent
src=(root.parent/'src/input_processors/input_processor_inertial_scroll.c').read_text()
header=(root.parent/'src/input_processors/inertial_scroll.h').read_text()
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
#define ARG_UNUSED(x) (void)(x)
#define CONTAINER_OF(p,t,m) ((t *)((char *)(p)-offsetof(t,m)))
#define INPUT_REL_WHEEL 8
#define INPUT_REL_HWHEEL 6
#define INPUT_EV_REL 2
#define ZMK_INPUT_PROC_CONTINUE 0
#define K_MSEC(x) (x)
#define DT_INST_FOREACH_STATUS_OKAY(x)
struct device {void *data;};
struct input_event {uint16_t type,code; int32_t value;};
struct zmk_input_processor_state {int unused;};
struct zmk_input_processor_driver_api {int (*handle_event)(const struct device *,struct input_event *,uint32_t,uint32_t,struct zmk_input_processor_state *);};
struct k_work {int unused;};
struct k_work_delayable {struct k_work work;};
struct k_spinlock {int unused;};
typedef int k_spinlock_key_t;
static int64_t clock_ms, deadline;
static bool scheduled;
static int out_x,out_y, emissions,total_x,total_y;
static int k_spin_lock(struct k_spinlock *l){(void)l; return 0;}
static void k_spin_unlock(struct k_spinlock *l,int k){(void)l;(void)k;}
static int64_t k_uptime_get(void){return clock_ms;}
static void k_work_init_delayable(struct k_work_delayable*w,void(*cb)(struct k_work*)){(void)w;(void)cb;}
static struct k_work_delayable *k_work_delayable_from_work(struct k_work*w){return CONTAINER_OF(w,struct k_work_delayable,work);}
static int k_work_reschedule(struct k_work_delayable*w,int64_t dt){(void)w;scheduled=true;deadline=clock_ms+dt;return 0;}
static int k_work_cancel_delayable(struct k_work_delayable*w){(void)w;scheduled=false;return 0;}
static void zmk_hid_mouse_scroll_set(int x,int y){out_x=x;out_y=y;}
static int zmk_endpoint_send_mouse_report(void){assert(out_x>=-4&&out_x<=4&&out_y>=-4&&out_y<=4);emissions++;total_x+=out_x;total_y+=out_y;return 0;}
'''
post=r'''
static struct inertial_scroll_data d;
static struct device dev={&d};
static void reset(void){
 memset(&d,0,sizeof d);g_inertial_scroll_data=NULL;clock_ms=1000;
 scheduled=false;emissions=total_x=total_y=0;capture_end=0;
 inertial_scroll_init(&dev);
 struct zmk_inertial_scroll_settings s={true,20,80,85,100,64,20,80,4,40};
 assert(zmk_inertial_scroll_runtime_set(&s)==0);
}
static void input(int dt,int code,int value){
 clock_ms+=dt; struct input_event e={INPUT_EV_REL,code,value};
 assert(inertial_scroll_driver_api.handle_event(&dev,&e,0,0,NULL)==0);
 assert(e.value==value); // physical input is never changed
}
static void tick(void){assert(scheduled);clock_ms=deadline;scheduled=false;inertial_scroll_work_cb(&d.work.work);}
static void drain(void){int n=0;while(scheduled){assert(n++<300);tick();}}
int main(void){
 reset();for(int i=0;i<100;i++){input(100,8,1);assert(!scheduled);}assert(!emissions);
 reset();for(int i=0;i<100;i++){input(40,8,1);assert(!scheduled);} // 25 steps/sec
 reset();input(0,8,100);assert(!scheduled); // single burst is not enough
 reset();for(int i=0;i<4;i++)input(10,8,1);assert(scheduled&&deadline==clock_ms+80);drain();assert(total_y>0&&total_x==0);
 printf("Flick: %d steps in %d nonzero reports\n",total_y,emissions);
 reset();for(int i=0;i<4;i++)input(10,6,-1);drain();assert(total_x<0&&total_y==0);
 reset();for(int i=0;i<4;i++)input(10,8,1);input(10,8,-1);assert(!scheduled); // reverse cancels
 reset();for(int i=0;i<4;i++)input(10,8,1);tick();int n=emissions;input(1,8,1);assert(!scheduled&&emissions==n); // manual brake
 reset();for(int i=0;i<4;i++)input(10,8,1);input(50,8,1);assert(!scheduled); // slow finish disarms
 reset();d.axis[0].velocity=128;d.due_ms=clock_ms;scheduled=true;deadline=clock_ms;tick();assert(emissions==0);drain();assert(total_y<=2); // no forced one-step output
 reset();d.settings.max_ticks=2;for(int i=0;i<4;i++)input(10,8,2);drain();assert(d.ticks==2);
 reset();for(int i=0;i<4;i++)input(10,8,1);struct zmk_inertial_scroll_settings s=d.settings;s.enabled=false;zmk_inertial_scroll_runtime_set(&s);assert(!scheduled);input(0,8,9);assert(!scheduled);
 reset();for(int i=0;i<10;i++)input(1,8,INT32_MIN);drain();assert(total_y<0); // wide intermediate arithmetic
 reset();s=d.settings;s.tick_ms=0;s.decay_percent=255;s.min_velocity_q8=0;zmk_inertial_scroll_runtime_set(&s);assert(d.settings.tick_ms==1&&d.settings.decay_percent==99&&d.settings.min_velocity_q8==1);
 reset();s=d.settings;s.flick_min_counts=6;zmk_inertial_scroll_runtime_set(&s);for(int i=0;i<4;i++)input(10,8,1);assert(!scheduled);for(int i=0;i<2;i++)input(10,8,1);assert(scheduled);
 reset();s=d.settings;s.flick_window_ms=20;zmk_inertial_scroll_runtime_set(&s);for(int i=0;i<4;i++)input(10,8,1);assert(!scheduled);
 reset();s=d.settings;s.flick_max_gap_ms=10;zmk_inertial_scroll_runtime_set(&s);for(int i=0;i<10;i++)input(20,8,1);assert(!scheduled);
 reset();s=d.settings;s.flick_window_ms=0;s.flick_min_counts=0;s.flick_max_gap_ms=0;zmk_inertial_scroll_runtime_set(&s);assert(d.settings.flick_window_ms==80&&d.settings.flick_min_counts==4&&d.settings.flick_max_gap_ms==40);
 reset();s=d.settings;s.flick_window_ms=65535;s.flick_min_counts=65535;s.flick_max_gap_ms=65535;zmk_inertial_scroll_runtime_set(&s);assert(d.settings.flick_window_ms==200&&d.settings.flick_min_counts==64&&d.settings.flick_max_gap_ms==200);
 reset();struct mg_scroll_capture cap;assert(mg_scroll_capture_read(1,0,0,&cap)==0&&cap.active);uint32_t id=cap.id;
 for(int i=0;i<40;i++)input(10,8,1);assert(!scheduled);assert(mg_scroll_capture_read(2,id,0,&cap)==0&&!cap.active&&cap.total==40&&cap.count==32);assert(cap.samples[0].value==1);
 assert(mg_scroll_capture_read(0,id,32,&cap)==0&&cap.count==8);assert(mg_scroll_capture_read(0,id+1,0,&cap)==-EINVAL);
 reset();assert(mg_scroll_capture_read(1,0,0,&cap)==0);id=cap.id;for(int i=0;i<300;i++)input(1,6,-1);assert(mg_scroll_capture_read(2,id,0,&cap)==0&&cap.total==256&&cap.dropped==44);
 reset();assert(mg_scroll_capture_read(1,0,0,&cap)==0);input(10001,8,1);for(int i=0;i<4;i++)input(10,8,1);assert(scheduled); // capture expires without a stop RPC
 puts("PASS: configurable flick thresholds; ordinary scroll, isolated burst, flick, horizontal/reverse, manual brake, slow finish, fractions, limits, disable, integer bounds");
}
'''
(scratch/'test.c').write_text(pre+src+post)
subprocess.run(['cc','-std=c11','-Wall','-Wextra','-Werror','-fsanitize=address,undefined',str(scratch/'test.c'),'-o',str(scratch/'test')],check=True)
subprocess.run([str(scratch/'test')],check=True)
