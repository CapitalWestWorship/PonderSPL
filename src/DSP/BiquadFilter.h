#pragma once
#include <cmath>
#include <vector>

// Direct Form II Transposed Biquad Filter
// Numerically robust, low latency, standard audio filter section
class BiquadFilter {
public:
    double b0 = 1.0, b1 = 0.0, b2 = 0.0;
    double a1 = 0.0, a2 = 0.0;
    double s1 = 0.0, s2 = 0.0;

    BiquadFilter() {
        reset();
    }

    void setCoefficients(double inB0, double inB1, double inB2, double inA1, double inA2) {
        b0 = inB0;
        b1 = inB1;
        b2 = inB2;
        a1 = inA1;
        a2 = inA2;
    }

    void reset() {
        s1 = 0.0;
        s2 = 0.0;
    }

    inline float process(float x) {
        double xd = (double)x;
        double y = b0 * xd + s1;
        s1 = b1 * xd - a1 * y + s2;
        s2 = b2 * xd - a2 * y;
        return (float)y;
    }

    void processBuffer(const float* in, float* out, size_t count) {
        for (size_t i = 0; i < count; ++i) {
            out[i] = process(in[i]);
        }
    }
};

// Cascade of Biquads
class BiquadCascade {
public:
    std::vector<BiquadFilter> stages;
    double gain = 1.0;

    void reset() {
        for (auto& stage : stages) {
            stage.reset();
        }
    }

    inline float process(float x) {
        float sample = x * (float)gain;
        for (auto& stage : stages) {
            sample = stage.process(sample);
        }
        return sample;
    }

    void processBuffer(const float* in, float* out, size_t count) {
        for (size_t i = 0; i < count; ++i) {
            out[i] = process(in[i]);
        }
    }
};
