# Logo for Robots: exported program "Level 7: Dark Corridor"
#
# UNCALIBRATED. The timing constants below come from the Logo for Robots simulator, not
# from your robot. This is dead reckoning: moves are timed, there are no wheel encoders,
# so distances and angles will drift. Measure and tune every constant on the real robot.
#
# Wiring assumed: two motors through a motor-driver board. Each motor has one PWM pin
# (speed) and one direction pin. A front bumper switch pulls its pin to 0 when pressed.

import time
from machine import Pin, PWM

# Pin numbers: change these to match your wiring.
LEFT_PWM_PIN = 0
LEFT_DIR_PIN = 1
RIGHT_PWM_PIN = 2
RIGHT_DIR_PIN = 3
BUMPER_PIN = 4

# Uncalibrated constants, derived from the simulator. Tune them on a real robot.
MS_PER_CM = 20.83          # uncalibrated: ms per cm at power 100
MS_PER_DEG = 8.52          # uncalibrated: ms per degree at power 100
CRUISE_DUTY = 0.80         # uncalibrated: drive duty at power 100 (0 to 1)
TURN_DUTY = 0.60           # uncalibrated: turn duty at power 100 (0 to 1)
WALL_AHEAD_CM = 35         # uncalibrated: "wall-ahead" distance
UNTIL_BUMP_MAX_MS = 15000  # until-bump gives up after this
PWM_FREQ = 1000          # PWM frequency in Hz; check your motor-driver board

power = 1.0     # set by "power N" (0.1 to 1.0)
bumped = False  # set when the bumper is pressed, cleared by "if bumped"

_left_pwm = PWM(Pin(LEFT_PWM_PIN))
_right_pwm = PWM(Pin(RIGHT_PWM_PIN))
_left_pwm.freq(PWM_FREQ)
_right_pwm.freq(PWM_FREQ)
_left_dir = Pin(LEFT_DIR_PIN, Pin.OUT)
_right_dir = Pin(RIGHT_DIR_PIN, Pin.OUT)
_bumper = Pin(BUMPER_PIN, Pin.IN, Pin.PULL_UP)


def set_motors(left, right):
    """Signed duty per wheel, -1.0 to 1.0."""
    _left_dir.value(1 if left >= 0 else 0)
    _right_dir.value(1 if right >= 0 else 0)
    _left_pwm.duty_u16(int(min(1.0, abs(left)) * 65535))
    _right_pwm.duty_u16(int(min(1.0, abs(right)) * 65535))


def bumper_pressed():
    return _bumper.value() == 0


def read_distance_cm():
    """Placeholder: replace with code for your front distance sensor (in cm)."""
    return 999


def drive_for(left, right, ms):
    """Drive both wheels for a time, watching the bumper."""
    global bumped
    start = time.ticks_ms()
    set_motors(left, right)
    while time.ticks_diff(time.ticks_ms(), start) < ms:
        if bumper_pressed():
            bumped = True
        time.sleep_ms(5)
    set_motors(0, 0)


def until_bump():
    """Drive forward until the bumper is pressed, or give up after UNTIL_BUMP_MAX_MS."""
    global bumped
    start = time.ticks_ms()
    set_motors(CRUISE_DUTY * power, CRUISE_DUTY * power)
    while not bumper_pressed() and time.ticks_diff(time.ticks_ms(), start) < UNTIL_BUMP_MAX_MS:
        time.sleep_ms(5)
    if bumper_pressed():
        bumped = True
    set_motors(0, 0)


def check_bumped():
    global bumped
    b = bumped or bumper_pressed()
    bumped = False
    return b


def run_program():
    global power
    until_bump()  # line 1: until-bump
    drive_for(-CRUISE_DUTY * power, -CRUISE_DUTY * power, (15.0 * MS_PER_CM / power))  # line 2: back 15
    drive_for(TURN_DUTY * power, -TURN_DUTY * power, (90.0 * MS_PER_DEG / power))  # line 3: right 90
    drive_for(CRUISE_DUTY * power, CRUISE_DUTY * power, (50.0 * MS_PER_CM / power))  # line 4: forward 50
    if check_bumped():  # line 5: if bumped
        drive_for(-CRUISE_DUTY * power, -CRUISE_DUTY * power, (10.0 * MS_PER_CM / power))  # line 5: back 10
    set_motors(0, 0)


run_program()
