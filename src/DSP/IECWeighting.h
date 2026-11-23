#pragma once
#include "BiquadFilter.h"
#include <complex>

namespace IECWeighting {

// Helper to evaluate frequency response of a biquad at z
inline std::complex<double> evalBiquad(double b0, double b1, double b2, double a1, double a2, std::complex<double> z) {
    std::complex<double> z_inv = 1.0 / z;
    std::complex<double> z_inv2 = z_inv * z_inv;
    std::complex<double> num = b0 + b1 * z_inv + b2 * z_inv2;
    std::complex<double> den = 1.0 + a1 * z_inv + a2 * z_inv2;
    return num / den;
}

// Design IEC 61672-1:2013 A-Weighting Filter Cascade
inline BiquadCascade designAWeighting(double fs) {
    BiquadCascade cascade;
    cascade.stages.resize(3);

    const double pi = 3.14159265358979323846;
    const double f1 = 20.598997;
    const double f2 = 107.65265;
    const double f3 = 737.86223;
    const double f4 = 12194.217;

    const double w1 = 2.0 * pi * f1;
    const double w2 = 2.0 * pi * f2;
    const double w3 = 2.0 * pi * f3;
    const double w4 = 2.0 * pi * f4;

    const double c = 2.0 * fs;

    // Stage 1: (s / (s + w1))^2
    double a1_0 = (c + w1) * (c + w1);
    double b1_0 = (c * c) / a1_0;
    double b1_1 = (-2.0 * c * c) / a1_0;
    double b1_2 = (c * c) / a1_0;
    double a1_1 = (-2.0 * (c * c - w1 * w1)) / a1_0;
    double a1_2 = ((c - w1) * (c - w1)) / a1_0;
    cascade.stages[0].setCoefficients(b1_0, b1_1, b1_2, a1_1, a1_2);

    // Stage 2: s^2 / ((s + w2) * (s + w3))
    double a2_0 = (c + w2) * (c + w3);
    double b2_0 = (c * c) / a2_0;
    double b2_1 = (-2.0 * c * c) / a2_0;
    double b2_2 = (c * c) / a2_0;
    double a2_1 = (2.0 * w2 * w3 - 2.0 * c * c) / a2_0;
    double a2_2 = (c - w2) * (c - w3) / a2_0;
    cascade.stages[1].setCoefficients(b2_0, b2_1, b2_2, a2_1, a2_2);

    // Stage 3: w4^2 / (s + w4)^2
    double a3_0 = (c + w4) * (c + w4);
    double b3_0 = (w4 * w4) / a3_0;
    double b3_1 = (2.0 * w4 * w4) / a3_0;
    double b3_2 = (w4 * w4) / a3_0;
    double a3_1 = (-2.0 * (c * c - w4 * w4)) / a3_0;
    double a3_2 = ((c - w4) * (c - w4)) / a3_0;
    cascade.stages[2].setCoefficients(b3_0, b3_1, b3_2, a3_1, a3_2);

    // Normalization at 1000 Hz (0 dB reference)
    double w1k = 2.0 * pi * 1000.0;
    std::complex<double> z1k(std::cos(w1k / fs), std::sin(w1k / fs));
    std::complex<double> h1k = evalBiquad(b1_0, b1_1, b1_2, a1_1, a1_2, z1k) *
                              evalBiquad(b2_0, b2_1, b2_2, a2_1, a2_2, z1k) *
                              evalBiquad(b3_0, b3_1, b3_2, a3_1, a3_2, z1k);
    cascade.gain = 1.0 / std::abs(h1k);
    return cascade;
}

// Design IEC 61672-1:2013 C-Weighting Filter Cascade
inline BiquadCascade designCWeighting(double fs) {
    BiquadCascade cascade;
    cascade.stages.resize(2);

    const double pi = 3.14159265358979323846;
    const double f1 = 20.598997;
    const double f4 = 12194.217;

    const double w1 = 2.0 * pi * f1;
    const double w4 = 2.0 * pi * f4;

    const double c = 2.0 * fs;

    // Stage 1: (s / (s + w1))^2
    double a1_0 = (c + w1) * (c + w1);
    double b1_0 = (c * c) / a1_0;
    double b1_1 = (-2.0 * c * c) / a1_0;
    double b1_2 = (c * c) / a1_0;
    double a1_1 = (-2.0 * (c * c - w1 * w1)) / a1_0;
    double a1_2 = ((c - w1) * (c - w1)) / a1_0;
    cascade.stages[0].setCoefficients(b1_0, b1_1, b1_2, a1_1, a1_2);

    // Stage 2: w4^2 / (s + w4)^2
    double a2_0 = (c + w4) * (c + w4);
    double b2_0 = (w4 * w4) / a2_0;
    double b2_1 = (2.0 * w4 * w4) / a2_0;
    double b2_2 = (w4 * w4) / a2_0;
    double a2_1 = (-2.0 * (c * c - w4 * w4)) / a2_0;
    double a2_2 = ((c - w4) * (c - w4)) / a2_0;
    cascade.stages[1].setCoefficients(b2_0, b2_1, b2_2, a2_1, a2_2);

    // Normalization at 1000 Hz
    double w1k = 2.0 * pi * 1000.0;
    std::complex<double> z1k(std::cos(w1k / fs), std::sin(w1k / fs));
    std::complex<double> h1k = evalBiquad(b1_0, b1_1, b1_2, a1_1, a1_2, z1k) *
                              evalBiquad(b2_0, b2_1, b2_2, a2_1, a2_2, z1k);
    cascade.gain = 1.0 / std::abs(h1k);
    return cascade;
}

// Design Z-Weighting Filter (Flat with 10 Hz high-pass to remove DC / sub-audible drift)
inline BiquadCascade designZWeighting(double fs) {
    BiquadCascade cascade;
    cascade.stages.resize(1);

    const double pi = 3.14159265358979323846;
    const double f0 = 10.0;
    const double w0 = 2.0 * pi * f0 / fs;
    const double alpha = std::sin(w0) / (2.0 * 0.7071067811865475); // Q = 1/sqrt(2)
    const double cosw0 = std::cos(w0);

    double b0 = (1.0 + cosw0) / 2.0;
    double b1 = -(1.0 + cosw0);
    double b2 = (1.0 + cosw0) / 2.0;
    double a0 = 1.0 + alpha;
    double a1 = -2.0 * cosw0;
    double a2 = 1.0 - alpha;

    cascade.stages[0].setCoefficients(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
    cascade.gain = 1.0;
    return cascade;
}

} // namespace IECWeighting
