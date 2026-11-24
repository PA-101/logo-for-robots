// Logo for Robots: exported program "Level 4: Ice Hairpin"
//
// UNCALIBRATED. The timing constants below come from the Logo for Robots simulator, not
// from your robot. Measure and tune every constant on the real robot before you rely on it.
// Moves are timed: there are no wheel encoders, so distances and angles will drift.
//
// Provide these five functions for your board:
void setMotorPwm(int left, int right);   // signed PWM per wheel, -255 to 255
int readDistanceCm();                    // front distance sensor, in cm
bool bumperPressed();                    // front bumper switch, true while pressed
void delayMs(unsigned long ms);          // wait
unsigned long millisNow();               // milliseconds since start

// Uncalibrated constants, derived from the simulator. Tune them on a real robot.
const float MS_PER_CM = 20.83;            // uncalibrated: ms per cm at power 100
const float MS_PER_DEG = 8.52;           // uncalibrated: ms per degree at power 100
const int CRUISE_PWM = 204;                // uncalibrated: drive PWM at power 100
const int TURN_PWM = 153;                  // uncalibrated: turn PWM at power 100
const int WALL_AHEAD_CM = 35;              // uncalibrated: "wall-ahead" distance
const unsigned long UNTIL_BUMP_MAX_MS = 15000;  // until-bump gives up after this

float power = 1.0;     // set by "power N" (0.1 to 1.0)
bool bumped = false;   // set when the bumper is pressed, cleared by "if bumped"

int scaled(int pwm) { return (int)(pwm * power); }
unsigned long msFor(float msAtFullPower) { return (unsigned long)(msAtFullPower / power); }

// Drive both wheels for a time, watching the bumper.
void driveFor(int left, int right, unsigned long ms) {
  unsigned long start = millisNow();
  setMotorPwm(left, right);
  while (millisNow() - start < ms) {
    if (bumperPressed()) bumped = true;
    delayMs(5);
  }
  setMotorPwm(0, 0);
}

// Drive forward until the bumper is pressed, or give up after UNTIL_BUMP_MAX_MS.
void untilBump() {
  unsigned long start = millisNow();
  setMotorPwm(scaled(CRUISE_PWM), scaled(CRUISE_PWM));
  while (!bumperPressed() && millisNow() - start < UNTIL_BUMP_MAX_MS) delayMs(5);
  if (bumperPressed()) bumped = true;
  setMotorPwm(0, 0);
}

bool checkBumped() {
  bool b = bumped || bumperPressed();
  bumped = false;
  return b;
}

void runProgram() {
  power = 0.7;  // line 1: power 70
  driveFor(scaled(CRUISE_PWM), scaled(CRUISE_PWM), msFor(450.0 * MS_PER_CM));  // line 2: forward 450
  driveFor(scaled(TURN_PWM), -scaled(TURN_PWM), msFor(90.0 * MS_PER_DEG));  // line 3: right 90
  driveFor(scaled(CRUISE_PWM), scaled(CRUISE_PWM), msFor(100.0 * MS_PER_CM));  // line 4: forward 100
  driveFor(scaled(TURN_PWM), -scaled(TURN_PWM), msFor(90.0 * MS_PER_DEG));  // line 5: right 90
  driveFor(scaled(CRUISE_PWM), scaled(CRUISE_PWM), msFor(450.0 * MS_PER_CM));  // line 6: forward 450
  setMotorPwm(0, 0);
}
